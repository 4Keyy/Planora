using Microsoft.AspNetCore.Hosting;
using Planora.Auth.Application.Common.Interfaces;

namespace Planora.Auth.Infrastructure.Services.Common;

/// <summary>
/// Persists avatars locally under {WebRoot}/avatars/{userId}/{hash}/{size}.webp.
/// The hash subdirectory makes URLs content-addressed, so the same image deduplicates
/// and Cache-Control: immutable becomes safe (URL changes when content changes).
/// </summary>
public sealed class LocalAvatarStorage : IAvatarStorage
{
    public const string RootFolder = "avatars";

    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<LocalAvatarStorage> _logger;

    public LocalAvatarStorage(
        IWebHostEnvironment environment,
        ILogger<LocalAvatarStorage> logger)
    {
        _environment = environment;
        _logger = logger;
    }

    public async Task<AvatarManifest> PutAsync(
        Guid userId,
        ProcessedAvatar avatar,
        CancellationToken cancellationToken = default)
    {
        if (userId == Guid.Empty)
        {
            throw new ArgumentException("userId must be non-empty", nameof(userId));
        }

        var uploadsRoot = ResolveUploadsRoot();
        var userFolder = Path.Combine(uploadsRoot, RootFolder, userId.ToString("N"), avatar.ContentHash);
        Directory.CreateDirectory(userFolder);

        var urls = new Dictionary<AvatarSize, string>();
        foreach (var variant in avatar.Variants)
        {
            var fileName = $"{(int)variant.Size}.webp";
            var fullPath = Path.Combine(userFolder, fileName);
            EnsureWithinRoot(uploadsRoot, fullPath);

            await using var fs = new FileStream(fullPath, FileMode.Create, FileAccess.Write, FileShare.None);
            await fs.WriteAsync(variant.Data, cancellationToken);

            urls[variant.Size] = $"/{RootFolder}/{userId:N}/{avatar.ContentHash}/{fileName}";
        }

        // Best-effort cleanup of older hash directories for this user — keep only the latest.
        TryPruneOldRevisions(userId, keepHash: avatar.ContentHash);

        return new AvatarManifest(
            SmallUrl: urls[AvatarSize.Small],
            MediumUrl: urls[AvatarSize.Medium],
            LargeUrl: urls[AvatarSize.Large],
            ContentHash: avatar.ContentHash);
    }

    public Task DeleteAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        if (userId == Guid.Empty)
        {
            return Task.CompletedTask;
        }

        var uploadsRoot = ResolveUploadsRoot();
        var userFolder = Path.Combine(uploadsRoot, RootFolder, userId.ToString("N"));
        EnsureWithinRoot(uploadsRoot, userFolder);

        if (Directory.Exists(userFolder))
        {
            Directory.Delete(userFolder, recursive: true);
            _logger.LogInformation("Deleted avatar tree for user {UserId}", userId);
        }
        return Task.CompletedTask;
    }

    private void TryPruneOldRevisions(Guid userId, string keepHash)
    {
        try
        {
            var uploadsRoot = ResolveUploadsRoot();
            var userFolder = Path.Combine(uploadsRoot, RootFolder, userId.ToString("N"));
            if (!Directory.Exists(userFolder)) return;

            foreach (var dir in Directory.EnumerateDirectories(userFolder))
            {
                var name = Path.GetFileName(dir);
                if (!string.Equals(name, keepHash, StringComparison.Ordinal))
                {
                    Directory.Delete(dir, recursive: true);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to prune old avatar revisions for {UserId}", userId);
        }
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

    private static void EnsureWithinRoot(string root, string candidate)
    {
        var absoluteRoot = Path.GetFullPath(root)
            .TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var absoluteCandidate = Path.GetFullPath(candidate);
        if (!absoluteCandidate.StartsWith(absoluteRoot, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Avatar path escapes uploads root");
        }
    }
}
