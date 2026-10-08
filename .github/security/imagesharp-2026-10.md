# ImageSharp dependency triage — 2026-10-08

The October 7 NuGet advisory refresh made the PR's dependency scan report five
advisories for the centrally pinned `SixLabors.ImageSharp 3.1.11`. Auth
Infrastructure and the unit-test project reference it directly; Auth API and
Migrator inherit it. The security job failed on this package inventory. This
finding was resolved by replacing the adapter and dependency with SkiaSharp, as recorded below. No audit suppression or severity-gate change is included.

## Historical advisory reachability in the 3.1.11 avatar processor

This assessment concerns the specific paths described by these advisories in
the former 3.1.11 processor. It is a source-based assessment, not an exploit
reproduction or a claim that all image-processing risks are excluded.

| Advisory | Severity | Reported path | Current Planora path |
|---|---|---|---|
| [GHSA-gwg2-r3hj-4w44](https://github.com/advisories/GHSA-gwg2-r3hj-4w44) | Moderate | ICC CLUT allocation when parsing profile entries; v4 also supports decode-time ICC conversion | In v3, JPEG/PNG/WebP decoding constructs a lazy ICC profile. The processor clears `IccProfile` before cloning or encoding and never reads `Entries`. The described CLUT parser is not reached. |
| [GHSA-wmxv-xphr-5c9g](https://github.com/advisories/GHSA-wmxv-xphr-5c9g) | Moderate | A non-progressing BigTIFF IFD loop | TIFF/BigTIFF signatures fail the JPEG/PNG/WebP magic-byte allowlist before `Image.LoadAsync`. |
| [GHSA-j3p4-wp97-rph4](https://github.com/advisories/GHSA-j3p4-wp97-rph4) | High | Floating-point TIFF followed by `HistogramEqualization` | TIFF is rejected before decode; the processor does not call histogram equalization. |
| [GHSA-j9gm-c75j-xc9q](https://github.com/advisories/GHSA-j9gm-c75j-xc9q) | High | TIFF CCITT Group 3 encoding | The processor writes only WebP with an explicit `WebpEncoder`; it never creates a TIFF encoder. |
| [GHSA-jjfr-hcj7-qf5w](https://github.com/advisories/GHSA-jjfr-hcj7-qf5w) | High | TIFF CCITT Group 4 encoding | The same TIFF rejection and explicit WebP-only output apply. |

Historical evidence is the
[3.1.11 avatar processor before replacement](https://github.com/4Keyy/Planora/blob/925a96e3b1d5134db64d5cae317e0cff8ac98e4b/Services/AuthApi/Planora.Auth.Infrastructure/Services/Common/ImageSharpImageProcessor.cs):
`HasAllowedMagicBytes` runs before decode, `IccProfile` is cleared before
`image.Clone`, and all three variants use `SaveAsWebpAsync`.

Upstream 3.1.11 confirms the ICC distinction:
[IccProfile](https://github.com/SixLabors/ImageSharp/blob/v3.1.11/src/ImageSharp/Metadata/Profiles/ICC/IccProfile.cs)
stores the byte array without parsing entries; only the `Entries` getter calls
`InitializeEntries`. Its `CheckIsValid` reads header fields rather than CLUT
entries. The
[JPEG](https://github.com/SixLabors/ImageSharp/blob/v3.1.11/src/ImageSharp/Formats/Jpeg/JpegDecoderCore.cs),
[PNG](https://github.com/SixLabors/ImageSharp/blob/v3.1.11/src/ImageSharp/Formats/Png/PngDecoderCore.cs)
and
[WebP](https://github.com/SixLabors/ImageSharp/blob/v3.1.11/src/ImageSharp/Formats/Webp/WebpDecoderCore.cs)
decoders construct these profiles without reading their entries.

This limited reachability does not remove the dependency finding. The existing
CI inventory and high-severity restore gates remain enabled, so the PR's
security check was blocked on this dependency before the replacement.

## Patched versions and the build blocker

All five reviewed advisories identify **4.1.2** as patched and include the 3.x
line in their affected ranges. The official
[NuGet version index](https://api.nuget.org/v3-flatcontainer/sixlabors.imagesharp/index.json)
was checked on October 8: the latest published 3.x version is **3.1.12**.
Its [release](https://github.com/SixLabors/ImageSharp/releases/tag/v3.1.12) does
not provide these September 2026 fixes. The public 3.1.x branch's newest commit
was from April 2026; no published patched 3.x backport was found.

A trial central pin to 4.1.2 restored successfully. The Release Auth-test command
then failed before compilation/tests because the package's own
`SixLabors_ValidateLicense` target found no license. The official
[ImageSharp documentation](https://docs.sixlabors.com/articles/imagesharp/index.html#license)
requires a valid build-time license for direct dependencies starting with
4.0.0. The trial pin was returned to 3.1.11; the processor and its tests were
not changed. Release/API compatibility and the complete patched solution scan
have therefore not been validated.

The [Community license application](https://licensing.sixlabors.com/) supports
qualifying source-available/open-source projects, charities and businesses
under its stated revenue threshold. Eligibility and submission belong to the
project owner. No application was sent, no license/key was read, and no license
validation was bypassed.

## Historical license decision

The smallest implementation is an owner-obtained appropriate license followed
by the 4.1.2 pin, secure license delivery to local/CI/container builds, existing
avatar/Auth regressions, a Release build and a fresh transitive vulnerability
scan. License values must stay out of source, command output and public history;
follow the vendor's secret/environment guidance.

Replacing the image library would require a separate adapter, dependency and
deployment review while preserving the current JPEG/PNG/WebP, center crop,
metadata stripping and three-variant contract. A maintained 3.x fork would
require actual upstream security backports, independently tested source and
package provenance, and ongoing patch ownership. Neither option is included in
this PR or resolved by a version-number change.

## Resolution — SkiaSharp on 2026-10-08

The avatar adapter now uses MIT-licensed [SkiaSharp 4.153.1](https://www.nuget.org/packages/SkiaSharp/4.153.1) and its matching [Linux native assets](https://www.nuget.org/packages/SkiaSharp.NativeAssets.Linux.NoDependencies/4.153.1). ImageSharp is removed from the central package list, Auth Infrastructure and unit tests. No vendor license target was bypassed.

`SkiaImageProcessor` preserves the accepted JPEG/PNG/WebP formats, center crop, three lossy WebP variants (64/128/512, quality 85), immutable content-addressed storage and metadata privacy contract. Actual stream reads are capped at 5 MB; codec and dimensions are checked before allocating decoded pixels. Sampling uses Mitchell cubic. The Linux native package is required in the Auth container; this path does not require text/font rendering.

Executed evidence: 17 native Windows avatar tests passed, including bounded reads, truncated input, EXIF removal and center crop. A real Linux Docker API upload passed: all three stored WebP URLs returned 200 and decoded to the expected dimensions in Chrome; spoofed image content returned 415. A fresh transitive NuGet scan of all 32 solution projects reported zero affected packages. These observations do not establish the absence of future native-code advisories.

The independent full-graph npm gate still reports the separately documented development dependency findings. Backend remediation does not make the entire security workflow green.
