// Aluminum selection helper (Windows).
// Persistent console process speaking a line protocol on stdio:
//   CAPTURE -> "OK <base64-utf8-text>" | "ERR <reason>"
//   COPYKEY -> synthesizes Ctrl+C into the foreground app -> "OK" | "ERR <reason>"
//   EXIT    -> exits
// Base64 payload avoids all quoting/newline/encoding issues in captured text.
// Compiled with the .NET Framework 4.8 csc.exe that ships in Windows (C# 5 —
// no string interpolation, no null-conditional operators).
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;
using System.Windows.Automation.Text;
using System.Windows.Forms;

class SelectionHelper
{
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr pid);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool PeekMessage(out MSG msg, IntPtr hWnd, uint min, uint max, uint remove);

    struct MSG
    {
        public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam;
        public uint time; public int ptX; public int ptY;
    }

    [STAThread]
    static void Main()
    {
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            line = line.Trim();
            if (line == "CAPTURE")
            {
                Console.WriteLine(Capture());
            }
            else if (line == "COPYKEY")
            {
                try
                {
                    // NOTE: "OK" means the keystroke was POSTED, not that a copy
                    // happened — UIPI silently drops input to elevated windows.
                    SendKeys.SendWait("^c");
                    Console.WriteLine("OK");
                }
                catch (Exception e)
                {
                    Console.WriteLine("ERR sendkeys:" + e.GetType().Name);
                }
            }
            else if (line.StartsWith("FOREGROUND "))
            {
                Console.WriteLine(Foreground(line.Substring(11).Trim()));
            }
            else if (line == "EXIT")
            {
                return;
            }
            else
            {
                Console.WriteLine("ERR unknown-command");
            }
            Console.Out.Flush();
        }
    }

    // Windows only grants foreground to a process that owns the last input event.
    // A global-hotkey overlay never does, so ShowWindow draws it on top while the
    // keyboard keeps going to the previous app. Attaching this thread to the
    // foreground thread's input queue borrows its foreground rights long enough
    // to hand them to the target window.
    static string Foreground(string arg)
    {
        try
        {
            long h;
            if (!long.TryParse(arg, out h)) return "ERR bad-hwnd";
            IntPtr target = new IntPtr(h);

            MSG msg;
            PeekMessage(out msg, IntPtr.Zero, 0, 0, 0); // force a message queue on this thread

            IntPtr fg = GetForegroundWindow();
            uint fgThread = GetWindowThreadProcessId(fg, IntPtr.Zero);
            uint myThread = GetCurrentThreadId();
            bool attached = false;
            try
            {
                if (fgThread != 0 && fgThread != myThread)
                {
                    attached = AttachThreadInput(myThread, fgThread, true);
                }
                ShowWindow(target, 5); // SW_SHOW
                BringWindowToTop(target);
                SetForegroundWindow(target);
                SetFocus(target);
            }
            finally
            {
                if (attached) AttachThreadInput(myThread, fgThread, false);
            }
            return GetForegroundWindow() == target ? "OK" : "ERR not-foreground";
        }
        catch (Exception e)
        {
            return "ERR exception:" + e.GetType().Name;
        }
    }

    const int SEARCH_MAX_NODES = 200;
    const int SEARCH_MAX_DEPTH = 12;
    static int searched;

    static string Capture()
    {
        try
        {
            AutomationElement el = AutomationElement.FocusedElement;
            if (el == null) return "ERR no-focused-element";

            // fast path: the focused control exposes its own text (Win32 edit
            // controls, WPF, browser address bars)
            string direct = SelectionOf(el);
            if (direct != null) return Ok(direct);

            // Chromium and Electron apps focus a container, while the selection
            // lives on a Document node deeper in the tree, so search the window.
            AutomationElement window = TopLevelOf(el);
            if (window != null)
            {
                searched = 0;
                string found = SearchSelection(window, 0);
                if (found != null) return Ok(found);
            }
            return "ERR no-selection";
        }
        catch (Exception e)
        {
            return "ERR exception:" + e.GetType().Name;
        }
    }

    static string Ok(string text)
    {
        return "OK " + Convert.ToBase64String(Encoding.UTF8.GetBytes(text));
    }

    /** The element's selected text, or null when it has no text pattern or no selection. */
    static string SelectionOf(AutomationElement el)
    {
        object patObj;
        if (!el.TryGetCurrentPattern(TextPattern.Pattern, out patObj)) return null;
        try
        {
            TextPatternRange[] ranges = ((TextPattern)patObj).GetSelection();
            if (ranges == null || ranges.Length == 0) return null;
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < ranges.Length; i++) sb.Append(ranges[i].GetText(-1));
            string text = sb.ToString();
            return text.Length == 0 ? null : text;
        }
        catch
        {
            return null; // a provider that throws is one we skip, not a fatal error
        }
    }

    static AutomationElement TopLevelOf(AutomationElement el)
    {
        try
        {
            TreeWalker walker = TreeWalker.ControlViewWalker;
            AutomationElement cur = el;
            while (cur != null && cur.Current.ControlType != ControlType.Window)
            {
                AutomationElement parent = walker.GetParent(cur);
                if (parent == null || parent.Equals(AutomationElement.RootElement)) break;
                cur = parent;
            }
            return cur;
        }
        catch
        {
            return null;
        }
    }

    /** Depth-first hunt for the first element holding a non-empty selection. */
    static string SearchSelection(AutomationElement el, int depth)
    {
        if (el == null || depth > SEARCH_MAX_DEPTH || searched >= SEARCH_MAX_NODES) return null;
        searched++;

        string own = SelectionOf(el);
        if (own != null) return own;

        try
        {
            TreeWalker walker = TreeWalker.ControlViewWalker;
            AutomationElement child = walker.GetFirstChild(el);
            while (child != null && searched < SEARCH_MAX_NODES)
            {
                string found = SearchSelection(child, depth + 1);
                if (found != null) return found;
                child = walker.GetNextSibling(child);
            }
        }
        catch
        {
            /* a subtree that refuses to walk is one we skip */
        }
        return null;
    }
}
