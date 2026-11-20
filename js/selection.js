export const SELECTION_CHIPS = {
    frame: ['shape', 'colour', 'lights'],
    pillar: ['pillars'],
    light: ['lights'],
    flower: ['flowers'],
    decor: ['stage']
};

export function chipsForSelection(selection) {
    const chips = selection && SELECTION_CHIPS[selection.kind];
    return chips && chips.length ? chips : ['shape'];
}

export function nextSelectionChip(selection, index, same) {
    const chips = chipsForSelection(selection);
    if (!same) return { index: 0, chip: chips[0] };
    const at = Number.isInteger(index) ? index : 0;
    const next = ((at % chips.length) + 1) % chips.length;
    return { index: next, chip: chips[next] };
}

export function selectionForModel(model, lookups = {}) {
    if (!model) return null;
    const {
        mounted, flowers = [], decor = [],
        parsePillarKey, elementKey
    } = lookups;

    // A frame's fixtures are separate models, but tapping one should not
    // break the frame into parts. Fold the hit back onto its frame so the
    // body, the curtain and the lights share one outline and one chip cycle.
    if (model.elementOf && elementKey) {
        const { frameId } = model.elementOf;
        return {
            kind: 'frame',
            id: frameId,
            key: `frame:${frameId}`,
            focus: `frame:${frameId}`,
            chip: 'shape'
        };
    }

    if (model.pillarType && mounted && parsePillarKey) {
        for (const [key, models] of mounted) {
            const parsed = parsePillarKey(key);
            if (!parsed) continue;
            const index = models.indexOf(model);
            if (index < 0) continue;
            return {
                kind: 'pillar',
                frameId: parsed.frameId,
                type: parsed.type,
                index,
                key: `${key}:${index}`,
                focus: `pillar:${parsed.frameId}:${parsed.type}`,
                chip: 'pillars'
            };
        }
    }

    if (mounted) {
        for (const [key, models] of mounted) {
            if (!models.includes(model)) continue;
            return {
                kind: 'frame',
                id: key,
                key: `frame:${key}`,
                focus: `frame:${key}`,
                chip: 'shape'
            };
        }
    }

    const flower = flowers.find(fp => fp && fp.model === model);
    if (flower) {
        return {
            kind: 'flower',
            id: flower.id,
            key: `flower:${flower.id}`,
            focus: `flower:${flower.id}`,
            chip: 'flowers'
        };
    }

    const placed = decor.find(d => d && d.model === model);
    if (placed) {
        return {
            kind: 'decor',
            id: placed.id,
            key: `decor:${placed.id}`,
            focus: `decor:${placed.id}`,
            chip: 'stage'
        };
    }

    return null;
}
