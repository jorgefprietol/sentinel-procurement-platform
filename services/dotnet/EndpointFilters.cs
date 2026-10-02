namespace Sentinel;

// Attached to the protected route group. Authentication cannot be skipped by path comparisons.
public sealed class SessionFilter(Store store) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context,
        EndpointFilterDelegate next
    )
    {
        var actor = await store.Authenticate(context.HttpContext.Request.Cookies["sentinel_cs"]);
        context.HttpContext.Items["actor"] = actor;
        await store.Limit("user:" + actor.Id, 120, 60);
        return await next(context);
    }
}

// Attached to each mutation endpoint, including login. It always validates the origin.
public sealed class OriginFilter : IEndpointFilter
{
    private readonly string origin =
        Environment.GetEnvironmentVariable("APP_ORIGIN")
        ?? throw new InvalidOperationException("APP_ORIGIN required");

    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context,
        EndpointFilterDelegate next
    )
    {
        var request = context.HttpContext.Request;
        if (request.Headers.Origin != origin || request.Headers["X-Sentinel-Client"] != "web")
            throw new ApiError(403, "invalid_origin");
        return await next(context);
    }
}
