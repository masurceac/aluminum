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
    // a misbehaving app could hand back a non-AXUIElement CF type; a force-cast
    // would trap and kill the helper (the client never respawns it)
    guard CFGetTypeID(focusedRef) == AXUIElementGetTypeID() else {
        return "ERR not-an-element"
    }
    let focused = focusedRef as! AXUIElement

    var selectedRef: CFTypeRef?
    let selErr = AXUIElementCopyAttributeValue(
        focused, kAXSelectedTextAttribute as CFString, &selectedRef)
    guard selErr == .success else {
        return "ERR no-selected-text:\(selErr.rawValue)"
    }
    guard let text = selectedRef as? String else {
        return "ERR selected-text-not-string"
    }
    guard !text.isEmpty else { return "ERR empty-selection" }

    return "OK " + Data(text.utf8).base64EncodedString()
}

// NOTE: "OK" means the events were POSTED, not that the copy happened —
// CGEvent.post silently no-ops without Accessibility permission. The app-level
// isTrustedAccessibilityClient(true) check in the Electron main process is
// what surfaces the permission prompt; this helper does not duplicate it.
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

// NOTE: top-level code compiles only while this is the sole file passed to
// swiftc; a second .swift file in the module would require moving this loop
// into main.swift.
while let line = readLine() {
    // .whitespacesAndNewlines: readLine strips \n but leaves \r from CRLF senders
    switch line.trimmingCharacters(in: .whitespacesAndNewlines) {
    case "CAPTURE": print(capture())
    case "COPYKEY": print(sendCmdC())
    case "EXIT": exit(0)
    default: print("ERR unknown-command")
    }
    fflush(stdout)
}
