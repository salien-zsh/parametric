// Part document model. Everything here is plain JSON so a document can be
// saved, diffed for undo, and posted to the geometry worker unchanged.
// Lengths are stored in millimetres and angles in degrees regardless of the
// display unit system.

import type { Vec2, Vec3, Frame } from '../math/vec';

export type Id = string;

/** A numeric parameter: a literal, or an expression string such as "=Width/2". */
export type Param = number | string;

export type UnitSystem = 'MMGS' | 'CGS' | 'MKS' | 'IPS';
export type BasePlane = 'front' | 'top' | 'right';

// ---- Topology references ----
// Faces are named after the feature and sketch entity that created their
// surface, so references survive dimension changes. The geometric signature
// is a fallback used to disambiguate split faces.

export interface FaceSig {
  type: string;
  c: Vec3;
  n?: Vec3;
  area: number;
}

export interface EdgeSig {
  type: string;
  m: Vec3;
  len: number;
}

export interface FaceRef {
  name: string;
  sig: FaceSig;
}

export interface EdgeRef {
  name: string;
  sig: EdgeSig;
}

export interface VertexRef {
  p: Vec3;
}

export type PlaneRef =
  | { kind: 'base'; plane: BasePlane }
  | { kind: 'feature'; id: Id }
  | { kind: 'face'; face: FaceRef };

export type AxisRef =
  | { kind: 'base'; axis: 'x' | 'y' | 'z' }
  | { kind: 'edge'; edge: EdgeRef }
  | { kind: 'face'; face: FaceRef }
  | { kind: 'sketchLine'; sketch: Id; entity: Id };

// ---- Sketch ----

/**
 * Link from projected sketch geometry to the model. Every rebuild puts the
 * entity back on its model edge (or vertex), and the solver holds it fixed.
 * - edge: a line, arc or circle on the projected edge; a point for a straight
 *   edge seen end-on.
 * - vertex: a point on a model vertex, found again as the end the edges
 *   meeting there share (p is where it was, to pick between candidates).
 */
export type ExtRef =
  | { kind: 'edge'; edge: EdgeRef }
  | { kind: 'vertex'; edges: EdgeRef[]; p: Vec3 };

export interface SkBase {
  id: Id;
  construction?: boolean;
  /** Projected from the model and kept linked to it. */
  ext?: ExtRef;
}

export interface SkPoint extends SkBase {
  t: 'point';
  x: number;
  y: number;
}

export interface SkLine extends SkBase {
  t: 'line';
  a: Id;
  b: Id;
}

export interface SkCircle extends SkBase {
  t: 'circle';
  c: Id;
  r: number;
}

/** Counter-clockwise arc around c from a to b. */
export interface SkArc extends SkBase {
  t: 'arc';
  c: Id;
  a: Id;
  b: Id;
}

/** Smooth curve through its points (centripetal Catmull-Rom, exported as Beziers). */
export interface SkSpline extends SkBase {
  t: 'spline';
  pts: Id[];
}

export type SkEntity = SkPoint | SkLine | SkCircle | SkArc | SkSpline;
export type SkCurve = SkLine | SkCircle | SkArc | SkSpline;

export type RelationType =
  | 'coincident'
  | 'horizontal'
  | 'vertical'
  | 'parallel'
  | 'perpendicular'
  | 'tangent'
  | 'equal'
  | 'concentric'
  | 'midpoint'
  | 'collinear'
  | 'fix'
  | 'symmetric';

export type DimensionType = 'distance' | 'hdistance' | 'vdistance' | 'radius' | 'diameter' | 'angle';

export interface SkRelation {
  id: Id;
  type: RelationType;
  refs: Id[];
  /** Tangent circles: true when one lies inside the other. */
  internal?: boolean;
}

export interface SkDimension {
  id: Id;
  type: DimensionType;
  refs: Id[];
  value: Param;
  /** Reference (driven) dimensions report a value without constraining. */
  driven?: boolean;
  /** Label position in sketch coordinates. */
  at: Vec2;
  /** Dimension name used in equations, e.g. D1. */
  name: string;
  /** Angle dimensions: which of the four angles between two lines is meant. */
  sector?: number;
}

export type SkConstraint = SkRelation | SkDimension;

export const isDimension = (c: SkConstraint): c is SkDimension =>
  c.type === 'distance' || c.type === 'hdistance' || c.type === 'vdistance' ||
  c.type === 'radius' || c.type === 'diameter' || c.type === 'angle';

// ---- Features ----

export interface FeatureBase {
  id: Id;
  name: string;
  suppressed?: boolean;
  hidden?: boolean;
}

export interface SketchFeature extends FeatureBase {
  type: 'sketch';
  plane: PlaneRef;
  entities: SkEntity[];
  constraints: SkConstraint[];
  /** Plane frame resolved at the last rebuild (kept for display while editing). */
  frame?: Frame;
}

export type EndCondition = 'blind' | 'throughAll' | 'midPlane';

export interface ExtrudeDir2 {
  end: 'blind' | 'throughAll';
  depth: Param;
}

export interface ThinOptions {
  thickness: Param;
  /** one side (direction of the profile normal), the other side, or both. */
  side: 'outside' | 'inside' | 'mid';
}

export interface ExtrudeFeature extends FeatureBase {
  type: 'extrude';
  sketch: Id;
  cut: boolean;
  end: EndCondition;
  depth: Param;
  flip: boolean;
  dir2: ExtrudeDir2 | null;
  draft: Param;
  draftOutward: boolean;
  thin: ThinOptions | null;
  /** Optional sample points (sketch coordinates) choosing which regions to use. */
  contours?: Vec2[];
}

export interface RevolveFeature extends FeatureBase {
  type: 'revolve';
  sketch: Id;
  cut: boolean;
  /** null picks the sketch's first centerline. */
  axis: AxisRef | null;
  end: 'blind' | 'midPlane';
  angle: Param;
  flip: boolean;
  thin: ThinOptions | null;
  contours?: Vec2[];
}

export interface FilletFeature extends FeatureBase {
  type: 'fillet';
  edges: EdgeRef[];
  faces: FaceRef[];
  radius: Param;
}

export interface ChamferFeature extends FeatureBase {
  type: 'chamfer';
  edges: EdgeRef[];
  faces: FaceRef[];
  mode: 'distance' | 'distanceAngle' | 'twoDistance';
  distance: Param;
  distance2: Param;
  angle: Param;
  flip: boolean;
}

export interface ShellFeature extends FeatureBase {
  type: 'shell';
  faces: FaceRef[];
  thickness: Param;
  outward: boolean;
}

export type HoleKind = 'simple' | 'counterbore' | 'doubleCounterbore' | 'countersink' | 'counterdrill' | 'spotface' | 'tapped';
export type HoleTip = 'flat' | 'drill';
export type HoleEnd = 'blind' | 'throughAll' | 'toObject';

export interface HoleFeature extends FeatureBase {
  type: 'hole';
  /** Sketch whose points mark hole centres; the sketch plane sets the direction. */
  sketch: Id;
  kind: HoleKind;
  diameter: Param;
  end: HoleEnd;
  depth: Param;
  /** To Object: the planar face the hole stops at. */
  toFace?: FaceRef | null;
  cbDiameter: Param;
  cbDepth: Param;
  csDiameter: Param;
  csAngle: Param;
  /** Second, larger counterbore for a double-counterbored hole. */
  cb2Diameter?: Param;
  cb2Depth?: Param;
  /** Counterdrill cylindrical recess and its tapered transition into the hole. */
  cdDiameter?: Param;
  cdDepth?: Param;
  cdAngle?: Param;
  /** Spotface seat dimensions (older documents do not contain these). */
  sfDiameter?: Param;
  sfDepth?: Param;
  /** Thread metadata for a tapped hole. The cut is made at the tap drill diameter. */
  threadSize?: string;
  threadPitch?: Param;
  threadClass?: string;
  tapDrillDiameter?: Param;
  /** Blind-hole bottom: flat or a conical drill point beyond the nominal depth. */
  tip?: HoleTip;
  tipAngle?: Param;
  flip: boolean;
}

export interface PatternDir {
  ref: AxisRef | null;
  spacing: Param;
  count: Param;
  flip: boolean;
}

export interface LinearPatternFeature extends FeatureBase {
  type: 'linearPattern';
  seeds: Id[];
  dir1: PatternDir;
  dir2: PatternDir | null;
}

export interface CircularPatternFeature extends FeatureBase {
  type: 'circularPattern';
  seeds: Id[];
  axis: AxisRef | null;
  angle: Param;
  count: Param;
  equal: boolean;
  flip: boolean;
}

export interface MirrorFeature extends FeatureBase {
  type: 'mirror';
  /** Features to mirror; empty mirrors the whole body. */
  seeds: Id[];
  plane: PlaneRef | null;
}

/** How a reference plane is defined. Files written before plane types have only ref/offset and are offset planes. */
export type PlaneKind = 'offset' | 'midplane' | 'angle' | 'tangent' | 'twoEdges' | 'threePoints';

export interface PlaneFeature extends FeatureBase {
  type: 'plane';
  kind?: PlaneKind;
  ref: PlaneRef | null;
  /** Offset plane: distance along the normal. */
  offset: Param;
  flip: boolean;
  /** Midplane: the second parallel reference. */
  ref2?: PlaneRef | null;
  /** Plane at angle: the axis to rotate about, and the angle in degrees. */
  axis?: AxisRef | null;
  angle?: Param;
  /** Tangent plane: the curved face it touches, and where it touches it (defaults to the face centre). */
  face?: FaceRef | null;
  point?: Vec3 | null;
  /** Plane through two edges (both straight) or through three points. */
  edges?: EdgeRef[];
  points?: Vec3[];
}

export interface LoftFeature extends FeatureBase {
  type: 'loft';
  profiles: Id[];
  cut: boolean;
  ruled: boolean;
}

export interface SweepFeature extends FeatureBase {
  type: 'sweep';
  profile: Id | null;
  path: Id | null;
  cut: boolean;
}

export interface DraftFeature extends FeatureBase {
  type: 'draft';
  faces: FaceRef[];
  neutral: PlaneRef | null;
  angle: Param;
  flip: boolean;
}

/** A stepped shaft generator segment: a cylinder of one diameter and length. */
export interface ShaftSegment {
  diameter: Param;
  length: Param;
}

/** A keyway cut into one segment, on top of the shaft. */
export interface ShaftKeyway {
  segment: number;
  width: Param;
  depth: Param;
  length: Param;
}

/**
 * Mechanical shaft design: a stepped shaft along +X with optional end chamfers
 * and one keyway, plus the loads used for the torsional sizing check.
 */
export interface ShaftFeature extends FeatureBase {
  type: 'shaft';
  segments: ShaftSegment[];
  /** 45-degree chamfer at both ends (millimetres, 0 for none). */
  endChamfer: Param;
  keyway: ShaftKeyway | null;
  /** Mechanical inputs for the sizing report (they do not change the solid). */
  material: string;
  power: Param;
  speed: Param;
  serviceFactor: Param;
  allowableShear: Param;
}

/**
 * Power transmission generators (the Mechanical ribbon): gears, worm drives,
 * belt drives and chain sprockets. Dimensions are millimetres, angles degrees,
 * power kilowatts and speed rpm; the load fields only size the design report.
 */
export interface SpurGearFeature extends FeatureBase {
  type: 'spurGear';
  /** Normal module. */
  module: Param;
  teeth: Param;
  pressureAngle: Param;
  faceWidth: Param;
  bore: Param;
  /** Hub outside diameter (0 for none) and its total length. */
  hubDiameter: Param;
  hubLength: Param;
  material: string;
  power: Param;
  speed: Param;
  serviceFactor: Param;
}

/** A straight bevel gear; mateTeeth sets the 90-degree pitch cone angle. */
export interface BevelGearFeature extends FeatureBase {
  type: 'bevelGear';
  module: Param;
  teeth: Param;
  mateTeeth: Param;
  faceWidth: Param;
  bore: Param;
  pressureAngle: Param;
  material: string;
  power: Param;
  speed: Param;
  serviceFactor: Param;
}

/** A worm and worm wheel pair at a 90-degree shaft angle. */
export interface WormGearFeature extends FeatureBase {
  type: 'wormGear';
  module: Param;
  /** Number of worm starts (1 to 4). */
  wormStarts: Param;
  wheelTeeth: Param;
  wormDiameter: Param;
  wormLength: Param;
  faceWidth: Param;
  bore: Param;
  material: string;
  power: Param;
  speed: Param;
  serviceFactor: Param;
}

/** A two-sheave V-belt drive: grooved sheaves plus the belt around them. */
export interface VBeltFeature extends FeatureBase {
  type: 'vBelt';
  pulley1: Param;
  pulley2: Param;
  centerDistance: Param;
  /** Total axial belt width. */
  beltWidth: Param;
  beltThickness: Param;
  grooves: Param;
  material: string;
  power: Param;
  speed: Param;
  serviceFactor: Param;
}

/** A two-pulley synchronous belt drive; pulley sizes are tooth counts. */
export interface SyncBeltFeature extends FeatureBase {
  type: 'syncBelt';
  /** Tooth pitch of the belt and pulleys (mm). */
  toothPitch: Param;
  pulley1: Param;
  pulley2: Param;
  centerDistance: Param;
  beltWidth: Param;
  beltThickness: Param;
  material: string;
  power: Param;
  speed: Param;
  serviceFactor: Param;
}

/** A roller chain sprocket. */
export interface SprocketFeature extends FeatureBase {
  type: 'sprocket';
  pitch: Param;
  teeth: Param;
  rollerDiameter: Param;
  toothWidth: Param;
  bore: Param;
  hubDiameter: Param;
  hubLength: Param;
  material: string;
  power: Param;
  speed: Param;
  serviceFactor: Param;
}

export interface ImportFeature extends FeatureBase {
  type: 'import';
  format: 'step' | 'brep';
  /** Key into PartDocument.blobs holding the file text. */
  blob: Id;
  fileName: string;
}

export type Feature =
  | SketchFeature
  | ExtrudeFeature
  | RevolveFeature
  | FilletFeature
  | ChamferFeature
  | ShellFeature
  | HoleFeature
  | LinearPatternFeature
  | CircularPatternFeature
  | MirrorFeature
  | PlaneFeature
  | LoftFeature
  | SweepFeature
  | DraftFeature
  | ShaftFeature
  | SpurGearFeature
  | BevelGearFeature
  | WormGearFeature
  | VBeltFeature
  | SyncBeltFeature
  | SprocketFeature
  | ImportFeature;

export type FeatureType = Feature['type'];

export interface Variable {
  id: Id;
  name: string;
  expr: string;
}

export interface MaterialRef {
  name: string;
  /** kg/m^3 */
  density: number;
}

/** A component placed in an assembly. Lengths are millimetres; rotation is XYZ in degrees. */
export interface ComponentTransform {
  position: Vec3;
  rotation: Vec3;
}

/**
 * An assembly owns the part documents it places, so a saved assembly is
 * portable and does not depend on other files remaining in the same folder.
 */
export interface AssemblyComponent {
  id: Id;
  name: string;
  part: PartDocument;
  transform: ComponentTransform;
  visible: boolean;
  /** A grounded component is the reference for assembly mates. */
  fixed?: boolean;
}

export type AssemblyAxis = 'x' | 'y' | 'z';
export type AssemblyConnectorKind = 'origin' | 'x' | 'y' | 'z' | 'xy' | 'xz' | 'yz';
export type AssemblyMateType = 'coincident' | 'distance' | 'angle' | 'parallel' | 'perpendicular' | 'flush';

/** A lightweight assembly mate between the origins of two components. */
export interface AssemblyMate {
  id: Id;
  name: string;
  type: AssemblyMateType;
  /** Reference component. */
  a: Id;
  /** Driven component. */
  b: Id;
  /** Connector on the reference component. */
  aRef?: AssemblyConnectorKind;
  /** Connector on the driven component. */
  bRef?: AssemblyConnectorKind;
  axis: AssemblyAxis;
  value: number;
}

export type AssemblyJointType = 'rigid' | 'revolute' | 'prismatic' | 'cylindrical' | 'planar' | 'ball' | 'pinSlot';

/** A joint drives one component from its constrained position. */
export interface AssemblyJoint {
  id: Id;
  name: string;
  type: AssemblyJointType;
  component: Id;
  axis: AssemblyAxis;
  /** Secondary axis for planar/ball/cylindrical degrees of freedom. */
  axis2?: AssemblyAxis;
  /** Degrees for revolute joints, millimetres for prismatic joints. */
  value: number;
  min: number;
  max: number;
  /** Secondary motion value. Degrees for revolute/ball axes, mm for translation axes. */
  value2?: number;
  min2?: number;
  max2?: number;
}

export interface PartDocument {
  format: 'parametric-part';
  version: 1;
  /** Omitted in files written before assemblies existed; such files are parts. */
  kind?: 'part' | 'assembly';
  name: string;
  units: UnitSystem;
  /** Decimal places shown for lengths. */
  decimals: number;
  material: MaterialRef | null;
  color: string;
  variables: Variable[];
  /** Named parameter sets; missing overrides inherit the base variable expression. */
  configurations?: ParameterConfiguration[];
  activeConfiguration?: Id | null;
  features: Feature[];
  /** Features at index >= rollback are rolled back (not built). null = none. */
  rollback: number | null;
  /** Large payloads (imported geometry) kept out of undo snapshots. */
  blobs: Record<Id, string>;
  /** 2D drawing of the part (sheet with projected views), if created. */
  drawing?: DrawingDoc | null;
  /** Placed part documents. Only used when kind is "assembly". */
  components?: AssemblyComponent[];
  mates?: AssemblyMate[];
  joints?: AssemblyJoint[];
  nextId: number;
  created: number;
  modified: number;
}

export interface ParameterConfiguration {
  id: Id;
  name: string;
  /** Variable id -> value or expression for this configuration. */
  overrides: Record<Id, string>;
}

// ---- Drawings ----

export type SheetSize = 'A4' | 'A3' | 'A2' | 'A1' | 'Letter' | 'Tabloid';
export type DrawingViewKind = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric';

export interface DrawingView {
  id: Id;
  kind: DrawingViewKind;
  /** Centre of the view on the sheet, in sheet millimetres (y down). */
  x: number;
  y: number;
  hidden: boolean;
  /** Show overall width and height dimensions. */
  dims: boolean;
}

export interface DrawingDoc {
  sheet: SheetSize;
  landscape: boolean;
  /** Model to paper scale, e.g. 0.5 for 1:2. */
  scale: number;
  views: DrawingView[];
  title: string;
  drawnBy: string;
  notes: string;
}
