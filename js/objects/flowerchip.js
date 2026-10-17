// The Flowers shelf chip - a self-contained tool chip plus its shelf block,
// kept beside the flower engine rather than inline in panel.js. panel.js wires
// it into the toolbar right after Lights; everything flower-shelf-specific
// lives here.
//
// createFlowerChip(ctx) returns { chip, block }:
//   chip  - a TOOLS entry ({ id, label, icon, show }) spliced into the toolbar
//   block - a () => HTMLElement that renders the arrangement cards
//
// ctx: {
//   icon(paths)       - build the chip's SVG (the panel.js closure helper)
//   getFlowerList()   - the current Studio arrangement list
//   onMount(arr)      - mount one arrangement into the scene
//   onOpenStudio()    - open the Flower Studio
//   live              - the panel's live registry (its buttons get pushed here)
//   emptyNote(text)   - the panel's empty-state helper
// }

export const FLOWER_CHIP_ID = 'flowers';

const FLOWER_PATH = 'M12 21c-4-3-7-6-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4-3 7-7 10z';

export function createFlowerChip(ctx) {
    const list = () => ctx.getFlowerList() || [];

    const chip = {
        id: FLOWER_CHIP_ID,
        label: 'Flowers',
        icon: ctx.icon(FLOWER_PATH),
        // Always shown so the shelf is reachable even before anything is
        // saved - the block itself explains what to do when empty.
        show: () => true
    };

    function block() {
        const wrap = document.createElement('div');
        wrap.className = 'mb-2';
        const title = document.createElement('div');
        title.className = 'text-[11px] font-semibold uppercase tracking-wider '
            + 'text-gray-500 dark:text-zinc-400 mb-1.5';
        title.textContent = 'Arrangements';
        wrap.appendChild(title);

        // The one door into the Studio from the scene: a full-width primary
        // button when the library is empty (nothing else to click), a quiet
        // link once arrangement cards are showing.
        function studioButton(primary) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = primary
                ? 'mt-1 w-full h-8 rounded-md text-xs font-semibold text-white '
                    + 'bg-sky-600 hover:bg-sky-700 transition-colors'
                : 'mt-1 text-[11px] text-sky-600 dark:text-sky-400 hover:underline';
            b.textContent = primary ? 'Open the Flower Studio' : 'Open the Flower Studio →';
            b.title = 'Create or edit arrangements';
            b.addEventListener('click', () => { if (ctx.onOpenStudio) ctx.onOpenStudio(); });
            ctx.live.buttons.push(b);
            return b;
        }

        const flowerList = list();
        if (!flowerList.length) {
            wrap.appendChild(ctx.emptyNote(
                'Design and save an arrangement in the Flower Studio, then Mount it here.'));
            if (ctx.onOpenStudio) wrap.appendChild(studioButton(true));
            return wrap;
        }

        for (const arr of flowerList) {
            const card = document.createElement('div');
            card.className = 'mb-1.5 rounded-lg border border-gray-200 '
                + 'dark:border-zinc-700 bg-white/70 dark:bg-zinc-800/60 p-2';
            const s = (arr && arr.settings) || {};

            const head = document.createElement('div');
            head.className = 'flex items-center justify-between gap-2';
            const info = document.createElement('div');
            info.className = 'min-w-0';
            const name = document.createElement('strong');
            name.className = 'block text-xs font-semibold text-gray-700 '
                + 'dark:text-zinc-200 truncate';
            name.textContent = s.name || (arr && arr.id) || 'Arrangement';
            const meta = document.createElement('small');
            meta.className = 'block text-[11px] text-gray-500 dark:text-zinc-400';
            const nColors = (s.colors && s.colors.length) || 0;
            meta.textContent = `${s.width || 0} × ${s.height || 0} ft · `
                + `${nColors} colour${nColors === 1 ? '' : 's'}`;
            info.append(name, meta);
            head.appendChild(info);
            card.appendChild(head);

            const row = document.createElement('div');
            row.className = 'mt-1.5 flex items-center gap-1.5';
            const mount = document.createElement('button');
            mount.type = 'button';
            mount.className = 'px-2.5 h-7 rounded-md text-[11px] font-semibold '
                + 'border border-sky-500 text-sky-600 dark:text-sky-400 '
                + 'dark:border-sky-700 hover:bg-sky-50 dark:hover:bg-sky-900/40 '
                + 'transition-colors';
            mount.textContent = 'Mount';
            mount.title = 'Place this arrangement in the scene';
            mount.addEventListener('click', () => { if (ctx.onMount) ctx.onMount(arr); });
            ctx.live.buttons.push(mount);
            row.appendChild(mount);
            card.appendChild(row);
            wrap.appendChild(card);
        }

        if (ctx.onOpenStudio) wrap.appendChild(studioButton(false));
        return wrap;
    }

    return { chip, block };
}
