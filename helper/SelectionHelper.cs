// Aluminum selection helper (Windows).
// Persistent console process speaking a line protocol on stdio:
//   CAPTURE -> "OK <base64-utf8-text>" | "ERR <reason>"
//   COPYKEY -> synthesizes Ctrl+C into the foreground app -> "OK" | "ERR <reason>"
//   EXIT    -> exits
// Base64 payload avoids all quoting/newline/encoding issues in captured text.
// Compiled with the .NET Framework 4.8 csc.exe that ships in Windows (C# 5 —
// no string interpolation, no null-conditional operators).
using System;
using System.Text;
using System.Windows.Automation;
using System.Windows.Automation.Text;
using System.Windows.Forms;

class SelectionHelper
{
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

    static string Capture()
    {
        try
        {
            AutomationElement el = AutomationElement.FocusedElement;
            if (el == null) return "ERR no-focused-element";

            object patObj;
            if (!el.TryGetCurrentPattern(TextPattern.Pattern, out patObj))
                return "ERR no-text-pattern";

            TextPattern tp = (TextPattern)patObj;
            TextPatternRange[] ranges = tp.GetSelection();
            if (ranges == null || ranges.Length == 0) return "ERR no-selection";

            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < ranges.Length; i++)
            {
                sb.Append(ranges[i].GetText(-1));
            }
            string text = sb.ToString();
            if (text.Length == 0) return "ERR empty-selection";

            return "OK " + Convert.ToBase64String(Encoding.UTF8.GetBytes(text));
        }
        catch (Exception e)
        {
            return "ERR exception:" + e.GetType().Name;
        }
    }
}
