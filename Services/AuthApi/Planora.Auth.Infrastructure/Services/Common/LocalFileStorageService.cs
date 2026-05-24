using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;

namespace Planora.Auth.Infrastructure.Services.Common;

public sealed class LocalFileStorageService : IFileStorageService
{
    private static readonly Regex InvalidCharsRegex = new($"[{Regex.Escape(new string(Path.GetInvalidFileNameChars()))}]", RegexOptions.Compiled);

    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<LocalFileStorageService> _logger;

    public LocalFileStorageService(
        IWebHostEnvironment environment,
        ILogger<LocalFileStorageService> logger)
    {
        _environment = environment;
        _logger = logger;
    }

    public async Task<string> SaveFileAsync(
        Stream stream,
        string fileName,
        string folder,
        CancellationToken cancellationToken = default)
    {
        var normalizedFolder = NormalizeSegment(folder);
        var uploadsRoot = ResolveUploadsRoot();
        var targetDirectory = Path.Combine(uploadsRoot, normalizedFolder);
        Directory.CreateDirectory(targetDirectory);

        var extension = Path.GetExtension(fileName);
        var safeBaseName = string.IsNullOrWhiteSpace(Path.GetFileNameWithoutExtension(fileName))
            ? "file"
            : InvalidCharsRegex.Replace(Path.GetFileNameWithoutExtension(fileName), string.Empty);
        var generatedFileName = $"{safeBaseName}-{Guid.NewGuid():N}{extension}";
        var fullPath = Path.Combine(targetDirectory, generatedFileName);

        await using var fileStream = new FileStream(fullPath, FileMode.Create, FileAccess.Write, FileShare.None);
        await stream.CopyToAsync(fileStream, cancellationToken);

        return $"/{normalizedFolder}/{generatedFileName}";
    }

    public void DeleteFile(string filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath))
        {
            return;
        }

        var relativePath = filePath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
        var fullPath = Path.Combine(ResolveUploadsRoot(), relativePath);

        if (!File.Exists(fullPath))
        {
            return;
        }

        File.Delete(fullPath);
        _logger.LogInformation("Deleted uploaded file at {Path}", filePath);
    }

    private string ResolveUploadsRoot()
    {
        var webRoot = _environment.WebRootPath;
        if (!string.IsNullOrWhiteSpace(webRoot))
        {
            return webRoot;
        }

        return Path.Combine(_environment.ContentRootPath, "wwwroot");
    }

    private static string NormalizeSegment(string segment)
    {
        var trimmed = segment.Trim().Trim('/', '\\');
        return string.IsNullOrWhiteSpace(trimmed) ? "uploads" : trimmed;
    }
}
