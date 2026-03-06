export interface SvgToTikzOptions {
    precision?: number;
    scale?: number | null;
    standalone?: boolean;
}
export declare function svgToTikz(svgInput: string | Element, options?: SvgToTikzOptions): string;
