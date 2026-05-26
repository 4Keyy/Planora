namespace Planora.Auth.Application.Common.Interfaces;

public interface IFileStorageService
{
    Task<string> SaveFileAsync(
        Stream stream,
        string fileName,
        string folder,
        CancellationToken cancellationToken = default);

    Task<string> SaveBytesAsync(
        byte[] bytes,
        string fileName,
        string folder,
        CancellationToken cancellationToken = default);

    void DeleteFile(string filePath);
}
