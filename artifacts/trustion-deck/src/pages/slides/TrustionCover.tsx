const base = import.meta.env.BASE_URL;

export default function TrustionCover() {
  return (
    <div className="bp-slide relative h-screen w-screen overflow-hidden">
      <div className="bp-frame" />
      <div className="bp-crosshair-a" />
      <div className="bp-crosshair-b" />
      <div className="bp-dimension">ELEVATION A</div>
      <div className="bp-side-label">SECT. 01</div>
      <img
        src={`${base}maritime-hero.png`}
        crossOrigin="anonymous"
        alt="Technical blueprint view of a cargo vessel at sea"
        className="bp-hero-image"
      />
      <div className="bp-hero-overlay" />
      <div className="absolute left-[15vw] top-[17vh] z-10">
        <div className="bp-kicker">[ S3V-TRUSTION / FIELD SYSTEM ]</div>
        <div className="bp-meta mt-[1.2vh]">PROJECT NO. MAR-2026-EVIDENCE</div>
      </div>
      <div className="absolute left-[15vw] top-[31vh] z-10 w-[54vw]">
        <h1 className="bp-display m-0 text-[6.7vw] leading-[0.86]">
          <span className="block">S³V</span>
          <span className="block">TRUSTION</span>
        </h1>
        <div className="mt-[3vh] flex items-start gap-[1.3vw]">
          <div className="mt-[1.15vh] h-[0.2vh] w-[2vw] bg-accent" />
          <p className="bp-subtitle m-0 max-w-[35vw]">
            <span className="block">A sovereign maritime carbon evidence ledger</span>
            <span className="block">FuelEU Maritime + IMO DCS compliance evidence, built for forensic trust</span>
          </p>
        </div>
      </div>
      <div className="bp-footer right-[22vw]">
        <span>DRAWN BY: S³V SYSTEMS</span>
        <span>DATE: 2026</span>
        <span>SHEET: 01/08</span>
      </div>
      <div className="absolute bottom-[4vh] right-[4vw] h-[8vh] w-[15vw] border border-accent text-[0.75vw]">
        <div className="flex h-1/2 items-center border-b border-accent px-[0.6vw]">STATUS: ACTIVE</div>
        <div className="flex h-1/2 items-center px-[0.6vw]">SCALE: NTS</div>
      </div>
    </div>
  );
}