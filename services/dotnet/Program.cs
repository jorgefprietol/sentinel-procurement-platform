using Npgsql;
using Sentinel;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 8192);
builder.Services.AddSingleton(NpgsqlDataSource.Create(Environment.GetEnvironmentVariable("DB_CONNECTION") ?? throw new InvalidOperationException("DB_CONNECTION required")));
builder.Services.AddSingleton<Store>(); builder.Services.AddSingleton<Partner>();
var app = builder.Build();
var store = app.Services.GetRequiredService<Store>();
if (Environment.GetEnvironmentVariable("BOOTSTRAP_ENABLED") == "true") await store.Seed(Security.Required("BOOTSTRAP_PASSWORD"));
var origin = Environment.GetEnvironmentVariable("APP_ORIGIN") ?? throw new InvalidOperationException("APP_ORIGIN required");
var secureCookie = Environment.GetEnvironmentVariable("COOKIE_SECURE") != "false";
CookieOptions cookieOptions = new() { HttpOnly = true, Secure = secureCookie, SameSite = SameSiteMode.Strict, Path = "/", MaxAge = TimeSpan.FromMinutes(30) };
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["Cache-Control"] = "no-store";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    try
    {
        if (context.Request.QueryString.Value?.Length > 512) throw new ApiError(400, "invalid_query");
        if (context.Request.ContentLength > 8192) throw new ApiError(413, "body_too_large");
        if (HttpMethods.IsPost(context.Request.Method))
        {
            if (context.Request.Headers.Origin != origin || context.Request.Headers["X-Sentinel-Client"] != "web") throw new ApiError(403, "invalid_origin");
        }
        if (context.Request.Path == "/api/v1/auth/login")
            await store.Limit("login-global", 50, 60);
        else if (context.Request.Path.StartsWithSegments("/api/v1") && context.Request.Path != "/api/v1/meta")
        {
            var actor = await store.Authenticate(context.Request.Cookies["sentinel_cs"]);
            context.Items["actor"] = actor; await store.Limit("user:" + actor.Id, 120, 60);
        }
        await next();
    }
    catch (ApiError error)
    {
        context.Response.StatusCode = error.Status;
        if (error.Status == 429) context.Response.Headers["Retry-After"] = error.Message == "daily_quota"
            ? Math.Ceiling((DateTime.UtcNow.Date.AddDays(1) - DateTime.UtcNow).TotalSeconds).ToString(System.Globalization.CultureInfo.InvariantCulture) : "60";
        await context.Response.WriteAsJsonAsync(new { code = error.Message, traceId = context.TraceIdentifier });
    }
    catch (BadHttpRequestException error)
    { context.Response.StatusCode = error.StatusCode; await context.Response.WriteAsJsonAsync(new { code = "invalid_request" }); }
    catch (Exception error)
    {
        app.Logger.LogError("Request failed with {Type}, trace {TraceId}", error.GetType().Name, context.TraceIdentifier);
        context.Response.StatusCode = 500; await context.Response.WriteAsJsonAsync(new { code = "internal_error", traceId = context.TraceIdentifier });
    }
});
Actor Actor(HttpContext c) => (Actor)c.Items["actor"]!;
app.MapGet("/health", async () => await store.Healthy() ? Results.Ok(new { status = "UP" }) : Results.StatusCode(503));
app.MapGet("/api/v1/meta", () => new { service = "sentinel-procurement", implementation = "ASP.NET Core", version = "1.0.0", apiVersion = "v1", controls = 10 });
app.MapPost("/api/v1/auth/login", async (HttpContext c) =>
{ var token = await store.Login(await Security.Body<Login>(c.Request)); c.Response.Cookies.Append("sentinel_cs", token, cookieOptions); return Results.Ok(new { authenticated = true }); });
app.MapPost("/api/v1/auth/logout", async (HttpContext c) =>
{ await store.Logout(c.Request.Cookies["sentinel_cs"]!); c.Response.Cookies.Delete("sentinel_cs", cookieOptions); return Results.NoContent(); });
app.MapGet("/api/v1/me", (HttpContext c) => Actor(c));
app.MapGet("/api/v1/purchases", async (HttpContext c) =>
{
    var raw = c.Request.Query["limit"].ToString();
    if (!int.TryParse(raw.Length == 0 ? "20" : raw, out var limit) || limit is < 1 or > 50) throw new ApiError(400, "invalid_limit");
    return Results.Ok(await store.List(Actor(c), limit));
});
app.MapGet("/api/v1/purchases/{id:guid}", async (HttpContext c, Guid id) => Results.Ok(await store.Get(Actor(c), id)));
app.MapPost("/api/v1/purchases", async (HttpContext c) =>
{
    if (!Guid.TryParse(c.Request.Headers["Idempotency-Key"], out var key)) throw new ApiError(400, "idempotency_key_required");
    var result = await store.Create(Actor(c), await Security.Body<CreatePurchase>(c.Request), key);
    return Results.Json(await store.Get(Actor(c), result.Id), statusCode: result.Replay ? 200 : 201);
});
app.MapPost("/api/v1/purchases/{id:guid}/decision", async (HttpContext c, Guid id) =>
{
    // Wire name remains identical in both implementations.
    var body = await Security.Body<DecisionBody>(c.Request);
    await store.Decide(Actor(c), id, body.Decision); return Results.Ok(await store.Get(Actor(c), id));
});
app.MapGet("/api/v1/audit", async (HttpContext c) => Results.Ok(await store.AuditList(Actor(c))));
app.MapGet("/api/v1/vendors/{vendor}/risk", async (string vendor, Partner partner) => Results.Ok(await partner.Risk(vendor)));
app.Run();
record DecisionBody(string Decision);
