import { computed, onScopeDispose, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { router } from '@inertiajs/vue3';
import dayjs from 'dayjs';
import { formatDuration } from '@/packages/ui/src/utils/time';
import { useCurrentTimeEntryStore } from '@/utils/useCurrentTimeEntry';

/**
 * Keeps the browser tab in sync with the running timer so you can tell at a
 * glance whether solidtime is still tracking, even when the tab is in the
 * background:
 *
 *  - the tab title shows the running duration and the entry description
 *  - the favicon gets a green dot in the corner
 *
 * When no timer is running the original title and favicons are left untouched.
 */

export type TabTimerIndicator = 'idle' | 'work';

type TabTimerState = {
    indicator: TabTimerIndicator;
    durationSeconds: number;
    description: string | null | undefined;
};

const DOT_COLOR = '#22c55e';
const BASE_FAVICON_URL = '/favicons/favicon-32x32.png';
const DYNAMIC_FAVICON_ATTR = 'data-dynamic-favicon';

export function resolveTabTimerIndicator(isActive: boolean): TabTimerIndicator {
    return isActive ? 'work' : 'idle';
}

export function buildTabTitle(state: TabTimerState, baseTitle: string): string {
    if (state.indicator === 'idle') {
        return baseTitle;
    }
    const time = formatDuration(Math.max(0, Math.floor(state.durationSeconds)));
    const description = state.description?.trim();
    return `${time} · ${description ? description : 'No description'}`;
}

let stashedFavicons: HTMLLinkElement[] = [];

function applyDynamicFavicon(dataUri: string) {
    const existing = document.head.querySelector<HTMLLinkElement>(`link[${DYNAMIC_FAVICON_ATTR}]`);
    if (existing) {
        existing.href = dataUri;
        return;
    }
    stashedFavicons = Array.from(
        document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')
    );
    stashedFavicons.forEach((link) => link.remove());

    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.setAttribute(DYNAMIC_FAVICON_ATTR, 'true');
    link.href = dataUri;
    document.head.appendChild(link);
}

function restoreFavicon() {
    const dynamic = document.head.querySelectorAll(`link[${DYNAMIC_FAVICON_ATTR}]`);
    if (dynamic.length === 0 && stashedFavicons.length === 0) {
        return;
    }
    dynamic.forEach((link) => link.remove());
    stashedFavicons.forEach((link) => document.head.appendChild(link));
    stashedFavicons = [];
}

async function renderFaviconWithDot(color: string): Promise<string | null> {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return null;
    }

    await new Promise<void>((resolve) => {
        const image = new Image();
        image.onload = () => {
            ctx.drawImage(image, 0, 0, size, size);
            resolve();
        };
        image.onerror = () => resolve();
        image.src = BASE_FAVICON_URL;
    });

    const radius = 7;
    const center = size - radius - 1;

    ctx.beginPath();
    ctx.arc(center, center, radius + 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    return canvas.toDataURL('image/png');
}

export function useTabTimerIndicator() {
    const store = useCurrentTimeEntryStore();
    const { currentTimeEntry, now, isActive } = storeToRefs(store);

    // The plain page title, kept in sync with whatever Inertia last set.
    const pageTitle = ref(document.title);

    const indicator = computed(() => resolveTabTimerIndicator(isActive.value));

    const durationSeconds = computed(() => {
        if (!now.value || !currentTimeEntry.value.start) {
            return 0;
        }
        return now.value.diff(dayjs(currentTimeEntry.value.start), 's');
    });

    function applyTitle() {
        document.title = buildTabTitle(
            {
                indicator: indicator.value,
                durationSeconds: durationSeconds.value,
                description: currentTimeEntry.value.description,
            },
            pageTitle.value
        );
    }

    // Inertia rewrites document.title on every page visit. While idle that new
    // value IS the page title, so remember it; while a timer runs, re-apply the
    // timer title over whatever Inertia just set.
    const stopNavigateListener = router.on('navigate', () => {
        window.requestAnimationFrame(() => {
            if (indicator.value === 'idle') {
                pageTitle.value = document.title;
            } else {
                applyTitle();
            }
        });
    });

    watch(
        [indicator, durationSeconds],
        ([currentIndicator], [previousIndicator]) => {
            // A timer just started: document.title still holds the page title,
            // so capture it before we overwrite it with the timer title.
            if (currentIndicator !== 'idle' && previousIndicator === 'idle') {
                pageTitle.value = document.title;
            }
            applyTitle();
        },
        { immediate: true }
    );

    watch(
        indicator,
        async (value) => {
            if (value === 'idle') {
                restoreFavicon();
                return;
            }
            const dataUri = await renderFaviconWithDot(DOT_COLOR);
            if (dataUri) {
                applyDynamicFavicon(dataUri);
            }
        },
        { immediate: true }
    );

    onScopeDispose(() => {
        stopNavigateListener();
        restoreFavicon();
        document.title = pageTitle.value;
    });
}
