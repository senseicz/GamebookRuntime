# Build
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/GamebookRuntime/*.csproj ./
RUN dotnet restore
COPY src/GamebookRuntime/ ./
RUN dotnet publish -c Release -o /app/publish

# Run
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/publish .
COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
# Adventures are downloaded into this volume at container start.
VOLUME /data
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
