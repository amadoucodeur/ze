import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        borderRadius: 15,
        background: "#073a35",
      }}
    >
      <div style={{ position: "absolute", width: 34, height: 40, left: 22, top: 15, borderRadius: 7, background: "#286f56", opacity: .8, transform: "rotate(-1deg)" }} />
      <div style={{ position: "absolute", width: 35, height: 42, left: 17, top: 12, borderRadius: 7, background: "#72b989", transform: "rotate(-2deg)" }} />
      <div style={{ position: "absolute", width: 37, height: 44, left: 10, top: 8, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 7, color: "#10251f", background: "#dcff64", fontFamily: "Arial", fontSize: 31, fontWeight: 900, transform: "rotate(-7deg) skew(-3deg)" }}>Z</div>
    </div>,
    size,
  );
}
