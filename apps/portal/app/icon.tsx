import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#f3f2e9",
          borderRadius: 16,
        }}
      >
        <span
          style={{
            position: "absolute",
            right: 8,
            top: 13,
            width: 42,
            height: 42,
            borderRadius: 13,
            background: "linear-gradient(145deg, #7894b4, #2d7297)",
            transform: "rotate(7deg)",
          }}
        />
        <span
          style={{
            position: "absolute",
            left: 7,
            top: 7,
            width: 45,
            height: 46,
            display: "flex",
            overflow: "hidden",
            borderRadius: 14,
            background: "#06182c",
            transform: "rotate(-6deg)",
          }}
        >
          <span style={{ position: "absolute", left: 9, top: 9, width: 27, height: 9, borderRadius: 9, background: "#7894b4", transform: "skewX(-19deg)" }} />
          <span style={{ position: "absolute", left: 19, top: 8, width: 9, height: 31, borderRadius: 9, background: "#dcff64", transform: "rotate(42deg)" }} />
          <span style={{ position: "absolute", left: 8, bottom: 8, width: 29, height: 9, borderRadius: 9, background: "#f3f2e9", transform: "skewX(-19deg)" }} />
        </span>
        <span
          style={{
            position: "absolute",
            right: 5,
            bottom: 7,
            width: 11,
            height: 11,
            border: "3px solid #f3f2e9",
            borderRadius: "50%",
            background: "#dcff64",
          }}
        />
      </div>
    ),
    size,
  );
}
