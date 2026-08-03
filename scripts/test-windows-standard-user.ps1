param(
  [Parameter(Mandatory = $true)]
  [string]$ArtifactPath
)

$ErrorActionPreference = 'Stop'
$artifact = (Resolve-Path -LiteralPath $ArtifactPath).Path
$package = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\package.json') | ConvertFrom-Json
$expectedName = "GameplaySimulator-$($package.version)-windows-x64.exe"

if ([IO.Path]::GetFileName($artifact) -cne $expectedName) {
  throw "Standard-user validation requires $expectedName, not $([IO.Path]::GetFileName($artifact))."
}

function Get-OwnedProcessTreeIds {
  param([int[]]$RootProcessIds)

  $knownIds = [Collections.Generic.HashSet[int]]::new()
  foreach ($rootProcessId in $RootProcessIds) {
    if ($rootProcessId -gt 0) {
      [void]$knownIds.Add($rootProcessId)
    }
  }

  $processes = @(Get-CimInstance Win32_Process)
  do {
    $addedProcess = $false
    foreach ($process in $processes) {
      if (
        $knownIds.Contains([int]$process.ParentProcessId) -and
        $knownIds.Add([int]$process.ProcessId)
      ) {
        $addedProcess = $true
      }
    }
  } while ($addedProcess)

  return @($knownIds | ForEach-Object { [int]$_ })
}

$suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$testUser = "GSimRelease$suffix"
$plainPassword = "Gs!$([Guid]::NewGuid().ToString('N'))"
$securePassword = ConvertTo-SecureString $plainPassword -AsPlainText -Force
$credential = [Management.Automation.PSCredential]::new(".\$testUser", $securePassword)
$testRoot = Join-Path $env:PUBLIC "GameplaySimulator Standard User Test With Spaces $suffix"
$portablePath = Join-Path $testRoot $expectedName
$userDataPath = Join-Path $testRoot 'Writable User Data'
$markerPath = Join-Path $userDataPath 'standard-user-release-smoke.json'
$launcherPath = Join-Path $testRoot 'launch-standard-user-smoke.ps1'
$childProcess = $null
$ownedProcessIds = @()

try {
  New-LocalUser -Name $testUser -Password $securePassword -PasswordNeverExpires | Out-Null
  Add-LocalGroupMember -Group 'Users' -Member $testUser
  $administratorMember = Get-LocalGroupMember -Group 'Administrators' | Where-Object {
    $_.Name -like "*\$testUser"
  }
  if ($administratorMember) {
    throw 'The temporary release-test account unexpectedly has administrator membership.'
  }
  New-Item -ItemType Directory -Path $userDataPath -Force | Out-Null
  Copy-Item -LiteralPath $artifact -Destination $portablePath
  & icacls.exe $testRoot /grant "${testUser}:(OI)(CI)M" /T /Q | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not grant the temporary standard user access to the release-test directory.'
  }

  $escapedPortable = $portablePath.Replace("'", "''")
  $escapedUserData = $userDataPath.Replace("'", "''")
  $childCommand = @"
`$env:GAMEPLAY_SIMULATOR_RELEASE_SMOKE_TEST = '1'
`$env:GAMEPLAY_SIMULATOR_RELEASE_SMOKE_USER_DATA = '$escapedUserData'
`$env:GAMEPLAY_SIMULATOR_STANDARD_USER_SMOKE = '1'
& '$escapedPortable'
exit `$LASTEXITCODE
"@
  Set-Content -LiteralPath $launcherPath -Value $childCommand -Encoding utf8BOM
  $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $launcherArguments = "-NoProfile -NonInteractive -File `"$launcherPath`""
  $childProcess = Start-Process -FilePath $windowsPowerShell -ArgumentList $launcherArguments `
    -Credential $credential -LoadUserProfile -WorkingDirectory $testRoot -PassThru

  $deadline = [DateTime]::UtcNow.AddSeconds(180)
  while (-not (Test-Path -LiteralPath $markerPath) -and [DateTime]::UtcNow -lt $deadline) {
    if ($childProcess.HasExited -and $childProcess.ExitCode -ne 0) {
      throw "The portable launcher exited with code $($childProcess.ExitCode) before its standard-user readiness marker was written."
    }
    Start-Sleep -Milliseconds 250
  }
  if (-not (Test-Path -LiteralPath $markerPath)) {
    throw 'The portable application did not become ready under the standard user within 180 seconds.'
  }

  $marker = Get-Content -Raw -LiteralPath $markerPath | ConvertFrom-Json
  if ($marker.rendererLoaded -ne $true -or $marker.user -ine $testUser) {
    throw "The standard-user readiness marker was invalid: $($marker | ConvertTo-Json -Compress)"
  }
  if (-not $childProcess.WaitForExit(30000)) {
    throw 'The portable application did not close after the standard-user smoke check.'
  }

  $ownedProcessRoots = @($childProcess.Id, [int]$marker.processId)
  $cleanupDeadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    $ownedProcessIds = @(Get-OwnedProcessTreeIds -RootProcessIds ($ownedProcessRoots + $ownedProcessIds))
    $runningOwnedProcessIds = @($ownedProcessIds | Where-Object {
      Get-Process -Id $_ -ErrorAction SilentlyContinue
    })
    if ($runningOwnedProcessIds.Count -eq 0) {
      break
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $cleanupDeadline)

  if ($runningOwnedProcessIds.Count -ne 0) {
    throw "The standard-user smoke check left owned processes running: $($runningOwnedProcessIds -join ', ')."
  }

  $validation = [ordered]@{
    validatedAt = [DateTime]::UtcNow.ToString('o')
    operatingSystem = [Environment]::OSVersion.VersionString
    artifactFilename = $expectedName
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $artifact).Hash.ToLowerInvariant()
    installationMode = 'portable executable copied to and launched from a path containing spaces'
    launchIdentity = $marker.user
    administratorMembership = $false
    requestedExecutionLevel = 'asInvoker'
    testResults = [ordered]@{
      standardUserLaunch = 'passed'
      writableUserData = 'passed'
      rendererLoaded = 'passed'
      cleanExit = 'passed'
      ownedProcessCleanup = 'passed'
    }
  }
  $validationPath = Join-Path $PSScriptRoot "..\release\windows-validation-$($package.version)-standard-user.json"
  $validation | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $validationPath -Encoding utf8
  Write-Host "Standard-user portable validation passed for $expectedName as $($marker.user)."
}
finally {
  if ($childProcess -and -not $childProcess.HasExited) {
    & taskkill.exe /PID $childProcess.Id /T /F 2>$null | Out-Null
  }
  foreach ($processId in $ownedProcessIds) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
  if (Get-LocalUser -Name $testUser -ErrorAction SilentlyContinue) {
    Remove-LocalUser -Name $testUser
  }
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
  $plainPassword = $null
  $securePassword = $null
  $credential = $null
}
