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
COPY --from=build /app/publish .
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "GamebookRuntime.dll"]
