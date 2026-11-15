type $$ComponentProps = {
    /** 'live' while the drag moves, 'fading' through the 10s afterglow. */
    phase: 'live' | 'fading';
    width: number;
    testid?: string;
};
declare const WidthBadge: import("svelte").Component<$$ComponentProps, {}, "">;
type WidthBadge = ReturnType<typeof WidthBadge>;
export default WidthBadge;
