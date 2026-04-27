# Code Signing Certificate

This directory holds the self-signed `.pfx` certificate used to sign the Windows portable and installer executables.

> **⚠️ Do not commit the `.pfx` file to source control.** It is excluded via `.gitignore`.

## Why self-sign?

A self-signed certificate doesn't eliminate SmartScreen or Defender warnings on the first run (only a paid EV certificate does that), but it does:

- Give the executable a **consistent publisher identity** so Windows builds trust over time via reputation
- Prevent "Unknown publisher" from appearing as a blank field
- Make it possible for users to verify the binary hasn't been tampered with

## Generate the certificate (one-time, on Windows)

Open **PowerShell as Administrator** and run:

```powershell
# 1. Create a self-signed code-signing certificate (valid 5 years)
New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=Esri ArcGIS Velocity Simulator, O=Esri" `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -NotAfter (Get-Date).AddYears(5)

# 2. Find the certificate thumbprint
$cert = Get-ChildItem -Path "Cert:\CurrentUser\My" -CodeSigningCert |
  Where-Object { $_.Subject -like "*ArcGIS Velocity Simulator*" } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1
Write-Host "Thumbprint: $($cert.Thumbprint)"

# 3. Export to .pfx (you will be prompted or can set a password)
$password = Read-Host -AsSecureString "Enter PFX export password"
Export-PfxCertificate -Cert $cert -FilePath ".\certs\selfsigned.pfx" -Password $password
```

## Build with signing

Set the certificate path and password as environment variables before building:

**PowerShell:**
```powershell
$env:CSC_LINK = "certs\selfsigned.pfx"
$env:CSC_KEY_PASSWORD = "your-password-here"
npm run package:win
```

**Bash / zsh (cross-platform build from macOS/Linux):**
```bash
CSC_LINK=certs/selfsigned.pfx CSC_KEY_PASSWORD="your-password-here" npm run package:win
```

## Build without signing

To skip signing entirely (e.g. for quick local testing):

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:win
```

## Notes

- `electron-builder` v26+ uses **environment variables** for code signing — `CSC_LINK` (path to `.pfx`) and `CSC_KEY_PASSWORD` (certificate password).
- `CSC_LINK` can also be set to a base64-encoded string of the `.pfx` contents (useful in CI).
- For production releases, consider purchasing a proper code-signing certificate from a trusted CA.

