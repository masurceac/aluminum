// Aluminum selection helper (macOS).
// Same line protocol as the Windows helper (SelectionHelper.cs):
//   CAPTURE -> "OK <base64-utf8-text>" | "ERR <reason>"
//   COPYKEY -> synthesizes Cmd+C into the foreground app -> "OK" | "ERR <reason>"
//   EXIT    -> exits
// Requires Accessibility permission, attributed to the responsible process
// (for dev launches from a terminal, grant it to the terminal app).
import Foundation
import ApplicationServices
import CoreGraphics

func capture() -> String {
    let systemWide = AXUIElementCreateSystemWide()

    var focusedRef: CFTypeRef?
    let focusErr = AXUIElementCopyAttributeValue(
        systemWide, kAXFocusedUIElementAttribute as CFString, &focusedRef)
    guard focusErr == .success, let focusedRef = focusedRef else {
        return "ERR no-focused-element:\(focusErr.rawValue)"
    }
    let focused = focusedRef as! AXUIElement

    var selectedRef: CFTypeRef?
    let selErr = AXUIElementCopyAttributeValue(
        focused, kAXSelectedTextAttribute as CFString, &selectedRef)
    guard selErr == .success, let text = selectedRef as? String else {
        return "ERR no-selected-text:\(selErr.rawValue)"
    }
    guard !text.isEmpty else { return "ERR empty-selection" }

    return "OK " + Data(text.utf8).base64EncodedString()
}

func sendCmdC() -> String {
    guard let src = CGEventSource(stateID: .hidSystemState) else {
        return "ERR no-event-source"
    }
    let kVK_ANSI_C: CGKeyCode = 8
    guard
        let down = CGEvent(keyboardEventSource: src, virtualKey: kVK_ANSI_C, keyDown: true),
        let up = CGEvent(keyboardEventSource: src, virtualKey: kVK_ANSI_C, keyDown: false)
    else { return "ERR event-create-failed" }
    down.flags = .maskCommand
    up.flags = .maskCommand
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
    return "OK"
}

while let line = readLine() {
    switch line.trimmingCharacters(in: .whitespaces) {
    case "CAPTURE": print(capture())
    case "COPYKEY": print(sendCmdC())
    case "EXIT": exit(0)
    default: print("ERR unknown-command")
    }
    fflush(stdout)
}
