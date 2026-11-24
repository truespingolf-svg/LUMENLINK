export function isLinkLocalOrLoopbackIPv4(ip: string): boolean {
  if (!ip) return true;
  if (ip === '0.0.0.0') return true;
  if (ip.startsWith('127.')) return true;
  if (ip.startsWith('169.254.')) return true; // APIPA / link-local (unreachable from phones)
  return false;
}

export function isPrivateLanIPv4(ip: string): boolean {
  if (isLinkLocalOrLoopbackIPv4(ip)) return false;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('10.')) return true;
  const parts = ip.split('.').map(Number);
  if (parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }
  return false;
}

function ipPriorityScore(ip: string): number {
  if (ip.startsWith('192.168.137.')) return 0; // Windows Mobile Hotspot
  if (ip.startsWith('192.168.2.')) return 1; // macOS Internet Sharing
  if (ip.startsWith('192.168.')) return 2;
  if (ip.startsWith('10.')) return 3;
  if (isPrivateLanIPv4(ip)) return 4;
  return 5;
}

/**
 * Filters out loopback and 169.254.x.x link-local addresses and prioritizes real LAN / Hotspot IPs.
 */
export function filterLanIPv4Addresses(rawAddresses: string[]): string[] {
  const unique = Array.from(new Set(rawAddresses.map((a) => a.trim()).filter(Boolean)));
  const valid = unique.filter((ip) => !isLinkLocalOrLoopbackIPv4(ip));
  valid.sort((a, b) => ipPriorityScore(a) - ipPriorityScore(b));
  return valid;
}

function escapeWifiQrField(value: string): string {
  return value.replace(/([\\;,:""])/g, '\\$1');
}

export interface WifiQrConfig {
  ssid: string;
  password: string;
  encryption?: 'WPA' | 'WEP' | 'nopass';
  hidden?: boolean;
}

/**
 * Generates standard Android/iOS camera-scannable Wi-Fi auto-connect QR string.
 */
export function formatWifiQrPayload(config: WifiQrConfig): string {
  const encryption =
    config.encryption === 'nopass' || !config.password ? 'nopass' : config.encryption || 'WPA';
  const ssid = escapeWifiQrField(config.ssid.trim() || 'LUMENLINK-STAGE');
  const password = escapeWifiQrField(config.password || '');
  const hidden = config.hidden ? 'H:true;' : '';
  if (encryption === 'nopass') {
    return `WIFI:T:nopass;S:${ssid};${hidden};`;
  }
  return `WIFI:T:${encryption};S:${ssid};P:${password};${hidden};`;
}

export function deriveSharedPreviewUrl(rawUrl: string): {
  resolvedUrl: string;
  isAiStudioDevUrl: boolean;
  suggestedSharedUrl: string | null;
} {
  const clean = rawUrl.trim().replace(/\/$/, '');
  const isDev = /^https?:\/\/ais-dev-/i.test(clean);
  const suggestedSharedUrl = isDev ? clean.replace(/\/\/ais-dev-/i, '//ais-pre-') : null;
  return {
    resolvedUrl: clean,
    isAiStudioDevUrl: isDev,
    suggestedSharedUrl,
  };
}

export function resolvePublicJoinBaseUrl(params: {
  customBaseUrl?: string;
  publicUrl?: string;
  fallbackOrigin: string;
  lanAddresses?: string[];
  port?: number;
}): string {
  const custom = (params.customBaseUrl || '').trim().replace(/\/$/, '');
  if (custom) return custom;
  const rawBase = (params.publicUrl || params.fallbackOrigin).trim().replace(/\/$/, '');
  const info = deriveSharedPreviewUrl(rawBase);
  if (info.suggestedSharedUrl) return info.suggestedSharedUrl;
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(info.resolvedUrl);
  if (isLocalhost && params.lanAddresses && params.lanAddresses.length > 0) {
    return `http://${params.lanAddresses[0]}:${params.port || 3000}`;
  }
  return info.resolvedUrl;
}

export type JoinUrlProbeStatus = 'live' | 'not_published' | 'auth_required' | 'unreachable';

export function classifyJoinUrlProbe(params: {
  httpStatus: number;
  locationHeader?: string | null;
  url: string;
}): { status: JoinUrlProbeStatus; message: string } {
  const { httpStatus, locationHeader, url } = params;
  const loc = locationHeader || '';
  if (httpStatus >= 200 && httpStatus < 300) {
    return {
      status: 'live',
      message: 'Public Join URL is live (HTTP 200) and ready for audience phone scans.',
    };
  }
  if (
    httpStatus === 301 ||
    httpStatus === 302 ||
    httpStatus === 401 ||
    httpStatus === 403 ||
    loc.includes('__cookie_check') ||
    loc.includes('accounts.google.com')
  ) {
    return {
      status: 'auth_required',
      message:
        'This URL redirects to sign-in on other devices. Use a published Shared URL (ais-pre-...) or a local network IP.',
    };
  }
  if (httpStatus === 404) {
    const isSharedPreview = /ais-pre-/i.test(url);
    return {
      status: 'not_published',
      message: isSharedPreview
        ? 'Shared URL (ais-pre-...) returned HTTP 404 (blank page on phones) because the app is not published/shared yet.'
        : 'Join URL returned HTTP 404 (page not found).',
    };
  }
  return {
    status: 'unreachable',
    message: `URL returned HTTP ${httpStatus || 'error'} and may not load on audience phones.`,
  };
}

export function buildWindowsHotspotScript(ssid: string, password: string, port: number, showId: string): string {
  const safeSsid = ssid.replace(/["`$&|<>]/g, '').trim() || 'LUMENLINK-STAGE';
  const safePass = password.replace(/["`$&|<>]/g, '').trim();
  const isOpenNetwork = safePass.length === 0;

  if (isOpenNetwork) {
    return `@echo off
setlocal
title LUMENLINK Open Stage Network ^& Firewall Setup
echo ============================================================
echo   LUMENLINK - Open Local Network (No Password) ^& Firewall
echo ============================================================
echo.
echo [1/2] Allowing TCP Port ${port} through Windows Firewall (no internet required)...
netsh advfirewall firewall delete rule name="LUMENLINK Stage Server" >nul 2>&1
netsh advfirewall firewall add rule name="LUMENLINK Stage Server" dir=in action=allow protocol=TCP localport=${port}
if %errorlevel% neq 0 (
  echo   NOTE: Run this script as Administrator to add the Windows Firewall rule automatically.
) else (
  echo   Firewall rule added for TCP port ${port}.
)
echo.
echo [2/2] Open Wi-Fi Mode Active (No Password Required):
echo   Network Name (SSID): ${safeSsid}
echo   Security: Open (No Password)
echo.
echo   Note: Windows 11 built-in Mobile Hotspot requires an 8+ char WPA2 password by OS policy.
echo   For true zero-password auto-join, broadcast "${safeSsid}" as an Open network on a stage
echo   travel router / access point plugged into this computer (or enable a WPA2 password in
echo   LUMENLINK Join settings if using Windows Mobile Hotspot).
echo.
echo Audience Join URL over Local LAN / Router:
echo   http://192.168.137.1:${port}/join/${showId}
echo.
pause
`;
  }

  return `@echo off
setlocal
title LUMENLINK Local Stage Network Setup
echo ============================================================
echo   LUMENLINK - Computer Hosted Local Network ^& Firewall Setup
echo ============================================================
echo.
echo [1/2] Allowing TCP Port ${port} through Windows Firewall (no internet required)...
netsh advfirewall firewall delete rule name="LUMENLINK Stage Server" >nul 2>&1
netsh advfirewall firewall add rule name="LUMENLINK Stage Server" dir=in action=allow protocol=TCP localport=${port}
if %errorlevel% neq 0 (
  echo   NOTE: Run this script as Administrator to add the Windows Firewall rule automatically.
) else (
  echo   Firewall rule added for TCP port ${port}.
)
echo.
echo [2/2] Starting Windows Mobile Hotspot (${safeSsid})...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='SilentlyContinue'; ^
   Add-Type -AssemblyName System.Runtime.WindowsRuntime; ^
   $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]; ^
   Function Await($WinRtTask, $ResultType) { $netTask = $asTaskGeneric.MakeGenericMethod($ResultType).Invoke($null, @($WinRtTask)); $netTask.Wait(-1) | Out-Null; $netTask.Result }; ^
   $profile = [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]::GetInternetConnectionProfile(); ^
   if ($null -eq $profile) { $profiles = [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]::GetConnectionProfiles(); $profile = $profiles | Select-Object -First 1 }; ^
   if ($null -ne $profile) { ^
     $mgr = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]::CreateFromConnectionProfile($profile); ^
     $cfg = $mgr.GetCurrentAccessPointConfiguration(); ^
     $cfg.Ssid = '${safeSsid}'; ^
     $cfg.Passphrase = '${safePass}'; ^
     $null = Await ($mgr.ConfigureAccessPointAsync($cfg)) ([bool]); ^
     $res = Await ($mgr.StartTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult]); ^
     Write-Host ('Hotspot Status: ' + $res.Status) ^
   } else { ^
     Start-Process 'ms-settings:network-mobilehotspot' ^
   }"
echo.
echo Audience Join URL over Windows Mobile Hotspot:
echo   http://192.168.137.1:${port}/join/${showId}
echo.
echo If Windows Mobile Hotspot Settings opened, toggle "Mobile hotspot" ON
echo and set Network name: ${safeSsid}  Password: ${safePass}
echo.
pause
`;
}

