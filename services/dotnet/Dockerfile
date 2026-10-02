FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY services/dotnet/Sentinel.Api.csproj .
RUN dotnet restore
COPY services/dotnet/ .
RUN dotnet publish -c Release --no-restore -o /out
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /out .
ENV ASPNETCORE_URLS=http://+:8080
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "Sentinel.Api.dll"]
