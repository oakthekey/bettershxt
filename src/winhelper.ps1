# Persistent helper: reads one JSON command per line on stdin, writes one JSON line per response.
# Commands: {"cmd":"windows"} -> visible top-level window rects (physical px)
#           {"cmd":"scroll","x":..,"y":..,"delta":-120} -> mouse wheel at screen point
#           {"cmd":"quit"}
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class QS {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, int d, IntPtr e);
  [DllImport("user32.dll")] public static extern IntPtr GetShellWindow();
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public class Win { public long h; public string title; public int x, y, w, h2; }
  public static List<Win> List() {
    var list = new List<Win>();
    IntPtr shell = GetShellWindow();
    EnumWindows((h, l) => {
      if (h == shell || !IsWindowVisible(h) || IsIconic(h)) return true;
      int ex = GetWindowLong(h, -20);
      if ((ex & 0x80) != 0) return true; // WS_EX_TOOLWINDOW
      int len = GetWindowTextLength(h);
      if (len == 0) return true;
      var sb = new StringBuilder(len + 1); GetWindowText(h, sb, sb.Capacity);
      var cls = new StringBuilder(256); GetClassName(h, cls, 256);
      string c = cls.ToString();
      if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd") return true;

      int cloaked;
      if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      RECT r;
      if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0 || r.R - r.L <= 0) GetWindowRect(h, out r);
      if (r.R - r.L < 40 || r.B - r.T < 40) return true;
      list.Add(new Win { h = (long)h, title = sb.ToString(), x = r.L, y = r.T, w = r.R - r.L, h2 = r.B - r.T });
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
"@
$out = [Console]::Out
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $req = $line | ConvertFrom-Json
    switch ($req.cmd) {
      'windows' {
        $wins = [QS]::List() | ForEach-Object { @{ h = $_.h; title = $_.title; x = $_.x; y = $_.y; width = $_.w; height = $_.h2 } }
        $out.WriteLine((ConvertTo-Json -Compress -InputObject @($wins)))
      }
      'scroll' {
        [QS]::SetCursorPos([int]$req.x, [int]$req.y) | Out-Null
        [QS]::mouse_event(0x0800, 0, 0, [int]$req.delta, [IntPtr]::Zero)
        $out.WriteLine('{"ok":true}')
      }
      'quit' { exit }
      default { $out.WriteLine('{"error":"unknown"}') }
    }
  } catch {
    $out.WriteLine(('{"error":' + (ConvertTo-Json -Compress $_.Exception.Message) + '}'))
  }
  $out.Flush()
}
