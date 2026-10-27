#define AppName "Device Control Center"
#define AppVersion "0.1.0"
[Setup]
AppName={#AppName}
AppVersion={#AppVersion}
DefaultDirName={autopf}\Device Control Center
DefaultGroupName=Device Control Center
OutputDir=output
OutputBaseFilename=Device-Control-Center-Setup
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
[Files]
Source: "..\bundle\node.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\bundle\dist\*"; DestDir: "{app}\dist"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\bundle\Start-Device-Control.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\bundle\platform-tools\*"; DestDir: "{app}\platform-tools"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{autoprograms}\Device Control Center"; Filename: "{app}\Start-Device-Control.cmd"
Name: "{autodesktop}\Device Control Center"; Filename: "{app}\Start-Device-Control.cmd"; Tasks: desktopicon
[Tasks]
Name: desktopicon; Description: "Create a desktop shortcut"; Flags: unchecked
[Run]
Filename: "{app}\Start-Device-Control.cmd"; Description: "Start Device Control Center"; Flags: postinstall skipifsilent nowait
