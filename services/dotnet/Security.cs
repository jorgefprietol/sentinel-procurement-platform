using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Sentinel;

public sealed class ApiError(int status, string code) : Exception(code)
{
    public int Status { get; } = status;
}

public record Actor(Guid Id, string Tenant, string Username, string Role);

public record Login(string Username, string Password);

public record CreatePurchase(string Title, long AmountCents, string Vendor);

public static class Security
{
    public const int Iterations = 600_000;
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        PropertyNameCaseInsensitive = false,
    };

    public static string Required(string name) =>
        Environment.GetEnvironmentVariable(name) is { Length: >= 16 } value
            ? value
            : throw new InvalidOperationException($"Missing or weak {name}");

    public static string Hash(string value) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    public static string PasswordHash(string value)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(value, salt, Iterations, HashAlgorithmName.SHA256, 32);
        return $"{Convert.ToBase64String(salt)}:{Convert.ToBase64String(hash)}";
    }

    public static bool Verify(string value, string stored)
    {
        var parts = stored.Split(':');
        return CryptographicOperations.FixedTimeEquals(
            Convert.FromBase64String(parts[1]),
            Rfc2898DeriveBytes.Pbkdf2(
                value,
                Convert.FromBase64String(parts[0]),
                Iterations,
                HashAlgorithmName.SHA256,
                32
            )
        );
    }

    public static async Task<T> Body<T>(HttpRequest request)
    {
        if (request.ContentType?.Split(';')[0] != "application/json")
            throw new ApiError(415, "json_required");
        try
        {
            return await JsonSerializer.DeserializeAsync<T>(request.Body, Json)
                ?? throw new ApiError(400, "invalid_body");
        }
        catch (JsonException)
        {
            throw new ApiError(400, "invalid_body");
        }
    }

    public static void Validate(CreatePurchase value)
    {
        if (
            value.Title is null
            || value.Title.Trim().Length is < 3 or > 120
            || value.AmountCents is < 1 or > 1_000_000
            || value.Vendor is not ("acme" or "globex")
        )
            throw new ApiError(400, "invalid_purchase");
    }

    public static void Approver(Actor actor)
    {
        if (actor.Role != "APPROVER")
            throw new ApiError(403, "forbidden");
    }
}
