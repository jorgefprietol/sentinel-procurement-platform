using System.Text.Json;

namespace Sentinel;

public sealed class Partner
{
    private readonly HttpClient client = new(new HttpClientHandler { AllowAutoRedirect = false })
    {
        Timeout = TimeSpan.FromSeconds(3),
    };
    private readonly string token = Security.Required("PARTNER_TOKEN");

    // The destination is a deployment constant; callers can select only catalog identifiers.
    public async Task<object> Risk(string vendor)
    {
        if (vendor is not ("acme" or "globex"))
            throw new ApiError(400, "invalid_vendor");
        try
        {
            using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            using var request = new HttpRequestMessage(
                HttpMethod.Get,
                $"http://partner:8080/vendors/{vendor}"
            );
            request.Headers.Add("X-Partner-Token", token);
            using var response = await client.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                cancellation.Token
            );
            if (
                response.StatusCode != System.Net.HttpStatusCode.OK
                || response.Content.Headers.ContentType?.MediaType != "application/json"
            )
                throw new ApiError(502, "partner_unavailable");
            await using var stream = await response.Content.ReadAsStreamAsync(cancellation.Token);
            var buffer = new byte[4097];
            var total = 0;
            while (total < buffer.Length)
            {
                var read = await stream.ReadAsync(buffer.AsMemory(total), cancellation.Token);
                if (read == 0)
                    break;
                total += read;
            }
            if (total > 4096)
                throw new ApiError(502, "invalid_partner_response");
            using var document = JsonDocument.Parse(buffer.AsMemory(0, total));
            var root = document.RootElement;
            if (
                root.ValueKind != JsonValueKind.Object
                || root.EnumerateObject().Count() != 3
                || root.GetProperty("vendor").GetString() != vendor
                || !root.GetProperty("score").TryGetInt32(out var score)
                || score is < 0 or > 100
                || root.GetProperty("rating").GetString() is not ("LOW" or "MEDIUM" or "HIGH")
            )
                throw new ApiError(502, "invalid_partner_response");
            return new
            {
                vendor,
                score,
                rating = root.GetProperty("rating").GetString(),
            };
        }
        catch (ApiError)
        {
            throw;
        }
        catch (Exception e)
            when (e
                    is HttpRequestException
                        or OperationCanceledException
                        or JsonException
                        or KeyNotFoundException
                        or InvalidOperationException
            )
        {
            throw new ApiError(502, "partner_unavailable");
        }
    }
}
