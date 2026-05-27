using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Planora.Auth.Application.Common.Interfaces;

namespace Planora.Auth.Infrastructure.Services.Common;

public sealed class LocalFileStorageService : IFileStorageService
{
    // Hardcoded cross-platform invalid set — Path.GetInvalidFileNameChars() on Linux
    // returns only NUL and '/', so a name like "danger:name?.webp" would slip through
    // on Linux but be rejected on Windows. Anything not in [A-Za-z0-9._-] is stripped.
    private static readonly Regex InvalidCharsRegex = new("[^A-Za-z0-9._-]", RegexOptions.Compiled);

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
        var (fullPath, generatedFileName, normalizedFolder) = PrepareTarget(fileName, folder);

        await using var fileStream = new FileStream(fullPath, FileMode.Create, FileAccess.Write, FileShare.None);
        await stream.CopyToAsync(fileStream, cancellationToken);

        return $"/{normalizedFolder}/{generatedFileName}";
    }

    public async Task<string> SaveBytesAsync(
        byte[] bytes,
        string fileName,
        string folder,
        CancellationToken cancellationToken = default)
    {
        var (fullPath, generatedFileName, normalizedFolder) = PrepareTarget(fileName, folder);

        await using var fileStream = new FileStream(fullPath, FileMode.Create, FileAccess.Write, FileShare.None);
        await fileStream.WriteAsync(bytes, cancellationToken);

        return $"/{normalizedFolder}/{generatedFileName}";
    }

    public void DeleteFile(string filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath))
        {
            return;
        }

        var relativePath = filePath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
        var uploadsRoot = ResolveUploadsRoot();
        var fullPath = Path.GetFullPath(Path.Combine(uploadsRoot, relativePath));

        // Guard against path traversal — must remain under uploadsRoot.
        var normalizedRoot = Path.GetFullPath(uploadsRoot)
            .TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!fullPath.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogWarning("Refused to delete file outside uploads root: {Path}", filePath);
            return;
        }

        if (!File.Exists(fullPath))
        {
            return;
        }

        File.Delete(fullPath);
        _logger.LogInformation("Deleted uploaded file at {Path}", filePath);
    }

    private (string FullPath, string GeneratedFileName, string NormalizedFolder) PrepareTarget(
        string fileName,
        string folder)
    {
        var normalizedFolder = NormalizeSegment(folder);
        var uploadsRoot = ResolveUploadsRoot();
        var targetDirectory = Path.Combine(uploadsRoot, normalizedFolder);
        Directory.CreateDirectory(targetDirectory);

        var extension = Path.GetExtension(fileName);
        var rawBase = Path.GetFileNameWithoutExtension(fileName);
        var safeBaseName = string.IsNullOrWhiteSpace(rawBase)
            ? "file"
            : InvalidCharsRegex.Replace(rawBase, string.Empty);
        if (string.IsNullOrWhiteSpace(safeBaseName))
        {
            safeBaseName = "file";
        }

        var generatedFileName = string.IsNullOrEmpty(extension)
            ? safeBaseName
            : $"{safeBaseName}{extension}";
        // Make sure caller-provided base name never collides with another upload.
        if (!safeBaseName.Contains('-') || !Guid.TryParseExact(safeBaseName.Split('-').Last(), "N", out _))
        {
            generatedFileName = $"{safeBaseName}-{Guid.NewGuid():N}{extension}";
        }

        var fullPath = Path.GetFullPath(Path.Combine(targetDirectory, generatedFileName));

        var normalizedRoot = Path.GetFullPath(uploadsRoot)
            .TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!fullPath.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Resolved upload path escapes the uploads root");
        }

        return (fullPath, generatedFileName, normalizedFolder);
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
        var trimmed = (segment ?? string.Empty).Trim().Trim('/', '\\');
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            return "uploads";
        }
        // Reject anything containing path separators or relative components.
        if (trimmed.Contains('/') || trimmed.Contains('\\') || trimmed.Contains("..", StringComparison.Ordinal))
        {
            throw new ArgumentException("Folder must be a single path segment", nameof(segment));
        }
        return trimmed;
    }
}
