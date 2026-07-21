type BrandLogoProps = {
  compact?: boolean;
  inverse?: boolean;
  className?: string;
};

function classes(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function ZeSuiteLogo({ compact = false, inverse = false, className }: BrandLogoProps) {
  return (
    <span
      className={classes("ze-brand ze-suite-brand", compact && "ze-brand-compact", inverse && "ze-brand-inverse", className)}
      role="img"
      aria-label="ZeSuite"
    >
      <span className="ze-suite-mark" aria-hidden="true">
        <span className="ze-suite-monogram-z">Z</span>
        <span className="ze-suite-monogram-s">S</span>
        <span className="ze-suite-monogram-link" />
      </span>
      {!compact && <span className="ze-brand-word"><b>Ze</b><span>Suite</span></span>}
    </span>
  );
}

export function ZeControlLogo({ compact = false, inverse = false, className }: BrandLogoProps) {
  return (
    <span
      className={classes("ze-brand ze-control-brand", compact && "ze-brand-compact", inverse && "ze-brand-inverse", className)}
      role="img"
      aria-label="ZeControl"
    >
      <span className="ze-control-mark" aria-hidden="true">
        <span className="ze-control-ring" />
        <span className="ze-control-hand ze-control-hand-hour" />
        <span className="ze-control-hand ze-control-hand-minute" />
        <span className="ze-control-dot" />
      </span>
      {!compact && <span className="ze-brand-word"><b>Ze</b><span>Control</span></span>}
    </span>
  );
}

export function ZeRecruitLogo({ compact = false, inverse = false, className }: BrandLogoProps) {
  return (
    <span
      className={classes("ze-brand ze-recruit-brand", compact && "ze-brand-compact", inverse && "ze-brand-inverse", className)}
      role="img"
      aria-label="ZeRecruit"
    >
      <span className="ze-recruit-mark" aria-hidden="true">
        <span className="ze-recruit-layer ze-recruit-layer-back" />
        <span className="ze-recruit-layer ze-recruit-layer-middle" />
        <span className="ze-recruit-face">Z</span>
      </span>
      {!compact && <span className="ze-brand-word"><b>Ze</b><span>Recruit</span></span>}
    </span>
  );
}
