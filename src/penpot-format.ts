export type PenpotFill = {
  fillColor?: string;
  fillOpacity?: number;
  fillColorGradient?: {
    type?: string;
    startX?: number;
    startY?: number;
    endX?: number;
    endY?: number;
    width?: number;
    stops?: Array<{ color?: string; opacity?: number; offset?: number }>;
  };
  fillImage?: { id: string; name?: string; width?: number; height?: number; mtype?: string };
};

export type PenpotTextNode = {
  type?: string;
  text?: string;
  children?: PenpotTextNode[];
  fontFamily?: string;
  fontSize?: string | number;
  fontWeight?: string | number;
  fontStyle?: string;
  lineHeight?: string | number;
  letterSpacing?: string | number;
  textAlign?: string;
  verticalAlign?: string;
  fills?: PenpotFill[];
};

export type PenpotShape = {
  id: string;
  name: string;
  type: string;
  x?: number | null;
  y?: number | null;
  width?: number | null;
  height?: number | null;
  selrect?: { x?: number; y?: number; width?: number; height?: number };
  shapes?: string[];
  maskedGroup?: boolean;
  fills?: PenpotFill[];
  strokes?: Array<{ strokeColor?: string; strokeOpacity?: number; strokeWidth?: number; strokeAlignment?: string; strokeStyle?: string }>;
  shadow?: Array<{ style?: string; offsetX?: number; offsetY?: number; blur?: number; spread?: number; hidden?: boolean; color?: string; opacity?: number }>;
  blur?: { value?: number; hidden?: boolean };
  opacity?: number;
  rotation?: number;
  hidden?: boolean;
  blocked?: boolean;
  flipX?: boolean;
  flipY?: boolean;
  r1?: number;
  r2?: number;
  r3?: number;
  r4?: number;
  content?: PenpotTextNode | string;
  positionData?: PenpotTextNode[];
  growType?: string;
};

export type PenpotManifest = { generatedBy?: string; files: Array<{ id: string; name: string }> };
export type PenpotPage = { id: string; name: string; index?: number };
export type PenpotMedia = { id: string; mediaId: string; mtype?: string; name?: string };
