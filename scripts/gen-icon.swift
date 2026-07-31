// Regenerates assets/icon.icns — the macOS app icon: the copper double-chevron
// tile from assets/icon.ico, redrawn at 1024px with the transparent margins
// macOS icons carry (an edge-to-edge Windows .ico looks oversized in Finder).
// Usage: swift scripts/gen-icon.swift <out-dir>   (writes icon-1024.png there;
// scripts/gen-icns.sh wraps this and assembles the .icns)
import Cocoa

let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
let size: CGFloat = 1024
// Apple's icon grid: an 824pt rounded square centered on a 1024pt canvas
let tile = NSRect(x: 100, y: 100, width: 824, height: 824)

let img = NSImage(size: NSSize(width: size, height: size))
img.lockFocus()

let squircle = NSBezierPath(roundedRect: tile, xRadius: 185, yRadius: 185)
NSGradient(
    starting: NSColor(calibratedRed: 0.875, green: 0.494, blue: 0.267, alpha: 1), // #DF7E44
    ending: NSColor(calibratedRed: 0.737, green: 0.333, blue: 0.078, alpha: 1)    // #BC5514
)!.draw(in: squircle, angle: -65)

func chevron(apex: NSPoint, halfSpan: CGFloat, drop: CGFloat, color: NSColor, width: CGFloat) {
    let p = NSBezierPath()
    p.move(to: NSPoint(x: apex.x - halfSpan, y: apex.y - drop))
    p.line(to: apex)
    p.line(to: NSPoint(x: apex.x + halfSpan, y: apex.y - drop))
    p.lineWidth = width
    p.lineCapStyle = .round
    p.lineJoinStyle = .round
    color.setStroke()
    p.stroke()
}

// AppKit coordinates: origin bottom-left
chevron(apex: NSPoint(x: 512, y: 512), halfSpan: 274, drop: 232,
        color: NSColor(calibratedRed: 0.925, green: 0.686, blue: 0.522, alpha: 1), width: 110) // peach
chevron(apex: NSPoint(x: 512, y: 731), halfSpan: 274, drop: 232,
        color: NSColor(calibratedRed: 1.0, green: 0.976, blue: 0.949, alpha: 1), width: 110)   // warm white

img.unlockFocus()

let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
rep.size = NSSize(width: size, height: size)
let png = rep.representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: "\(outDir)/icon-1024.png"))
print("wrote \(outDir)/icon-1024.png")
