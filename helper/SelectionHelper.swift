// Aluminum selection helper (macOS).
// Same line protocol as the Windows helper (SelectionHelper.cs):
//   CAPTURE -> "OK <base64-utf8-text>" | "ERR <reason>"
//   COPYKEY -> synthesizes Cmd+C into the foreground app -> "OK" | "ERR <reason>"
//   EXIT    -> exits
// Requires Accessibility permission, attributed to the responsible process
// (for dev launches from a terminal, grant it to the terminal app).
import Foundation
import AppKit
import ApplicationServices
import CoreGraphics

/** apps we already asked to turn their AX tree on — retrying the slow wait
 * loop for them on every capture would delay each summon by ~600ms.
 * Written from both the watcher thread and the capture path. */
var axWokenPids = Set<pid_t>()
let axWokenLock = NSLock()

/** marks pid as woken; returns true when this call was the first to do so */
func markWoken(_ pid: pid_t) -> Bool {
    axWokenLock.lock()
    defer { axWokenLock.unlock() }
    return axWokenPids.insert(pid).inserted
}

func capture() -> String {
    // Primary route: focused element of the frontmost application. The
    // system-wide route (AXUIElementCreateSystemWide + kAXFocusedUIElement)
    // returns kAXErrorCannotComplete (-25204) for every query on macOS 26,
    // so it is only the fallback. The helper has no pumping run loop, and
    // NSWorkspace refreshes frontmostApplication on run-loop turns — drain
    // pending sources first so a long-lived helper doesn't see a stale app.
    RunLoop.current.run(until: Date())

    var focusedRef: CFTypeRef?
    var focusErr = AXError.cannotComplete
    if let front = NSWorkspace.shared.frontmostApplication {
        let pid = front.processIdentifier
        let appEl = AXUIElementCreateApplication(pid)
        focusErr = AXUIElementCopyAttributeValue(
            appEl, kAXFocusedUIElementAttribute as CFString, &focusedRef)
        if focusErr != .success {
            // Chromium-family apps (Chrome, and Electron apps like Claude,
            // VS Code, Slack) ship with their accessibility tree disabled
            // until an assistive client announces itself. Setting
            // AXManualAccessibility turns it on; the tree then builds
            // asynchronously, so poll before giving up. The watcher thread
            // usually did the wake seconds ago — an already-woken app gets
            // only a short grace for a build still in flight. The total
            // budget must stay under the client's 1500ms request timeout.
            let first = markWoken(pid)
            if first {
                AXUIElementSetAttributeValue(
                    appEl, "AXManualAccessibility" as CFString, kCFBooleanTrue)
            }
            for _ in 0..<(first ? 12 : 3) {
                usleep(100_000)
                focusErr = AXUIElementCopyAttributeValue(
                    appEl, kAXFocusedUIElementAttribute as CFString, &focusedRef)
                if focusErr == .success { break }
            }
        }
    }
    if focusErr != .success || focusedRef == nil {
        let systemWide = AXUIElementCreateSystemWide()
        focusErr = AXUIElementCopyAttributeValue(
            systemWide, kAXFocusedUIElementAttribute as CFString, &focusedRef)
    }
    guard focusErr == .success, let focusedRef = focusedRef else {
        return "ERR no-focused-element:\(focusErr.rawValue)"
    }
    // a misbehaving app could hand back a non-AXUIElement CF type; a force-cast
    // would trap and kill the helper (the client's respawn budget is small)
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

// Pre-wake the frontmost app's AX tree in the background: doing the wake on
// demand inside capture() can exceed the client's 1500ms request budget on
// heavy Chromium apps (VS Code takes seconds to build its tree), so the
// first double-shift in a cold app would miss. By waking whichever app the
// user focuses, the tree is ready before they can physically double-tap.
// The thread only sets AX attributes — stdout stays owned by the main loop.
let axWatcher = Thread {
    while true {
        RunLoop.current.run(until: Date()) // refresh NSWorkspace state
        if let front = NSWorkspace.shared.frontmostApplication {
            let pid = front.processIdentifier
            let appEl = AXUIElementCreateApplication(pid)
            var ref: CFTypeRef?
            let err = AXUIElementCopyAttributeValue(
                appEl, kAXFocusedUIElementAttribute as CFString, &ref)
            if err != .success && markWoken(pid) {
                AXUIElementSetAttributeValue(
                    appEl, "AXManualAccessibility" as CFString, kCFBooleanTrue)
            }
        }
        Thread.sleep(forTimeInterval: 1.0)
    }
}
axWatcher.start()

// NOTE: top-level code compiles only while this is the sole file passed to
// swiftc; a second .swift file in the module would require moving this loop
// into main.swift.
while let line = readLine() {
    // .whitespacesAndNewlines: readLine strips \n but leaves \r from CRLF senders
    switch line.trimmingCharacters(in: .whitespacesAndNewlines) {
    case "CAPTURE": print(capture())
    case "COPYKEY": print(sendCmdC())
    case "EXIT": exit(0)
    // macOS has no foreground-lock equivalent: app.focus({steal:true}) in the
    // main process is sufficient, so the command exists only for protocol parity
    case let cmd where cmd.hasPrefix("FOREGROUND "): print("ERR unsupported-on-macos")
    default: print("ERR unknown-command")
    }
    fflush(stdout)
}
