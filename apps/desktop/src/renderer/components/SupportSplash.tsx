// The Ko-fi support splash, shown on startup until the user opts out.
//
// A real donation cannot be detected client-side — Ko-fi only reports those
// through server-side webhooks, and the tip widget fires no event back to the
// page. So "hide once they've donated" is self-reported: the "don't show this
// again" tick (also set automatically once they open the Ko-fi page) persists
// `supportPromptDismissed` in UiState and the splash never returns.
//
// The Ko-fi page opens in the user's real browser via `core.openSupportPage()`
// — no Ko-fi script or iframe is loaded into the renderer, so index.html's
// strict CSP is untouched.

import { useEffect, useState } from "react";

interface SupportSplashProps {
	/** Close the splash. `dontShowAgain` is persisted so it never reopens. */
	onDismiss: (dontShowAgain: boolean) => void;
}

export function SupportSplash({ onDismiss }: SupportSplashProps) {
	const [dontShowAgain, setDontShowAgain] = useState(false);
	const [opened, setOpened] = useState(false);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onDismiss(dontShowAgain);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onDismiss, dontShowAgain]);

	const openKofi = () => {
		void window.core.openSupportPage();
		// They've been sent to Ko-fi — assume this splash has done its job.
		setOpened(true);
		setDontShowAgain(true);
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
			onMouseDown={() => onDismiss(dontShowAgain)}
		>
			<div
				className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-xl"
				onMouseDown={(e) => e.stopPropagation()}
				role="dialog"
				aria-label="Support Super Duper Samples"
			>
				<h2 className="text-base font-semibold text-ink">
					Enjoying Super Duper Samples?
				</h2>
				<p className="mt-2 text-sm text-ink-muted">
					This app is completely free. If it has earned a place in your
					workflow, a small tip on Ko-fi keeps it maintained.{" "}
					<span aria-hidden>💛</span>
				</p>

				<div className="mt-5 flex flex-col gap-2">
					<button
						type="button"
						onClick={openKofi}
						className="rounded bg-accent px-3 py-2 text-sm font-medium text-accent-on hover:bg-accent-hover"
					>
						Support on Ko-fi ↗
					</button>
					<button
						type="button"
						onClick={() => onDismiss(dontShowAgain)}
						className="rounded border border-line px-3 py-2 text-sm text-ink-muted hover:border-line-strong hover:text-ink"
					>
						{opened ? "Dismiss" : "Maybe later"}
					</button>
				</div>

				{opened && (
					<p className="mt-3 text-xs text-ink-faint" aria-live="polite">
						Thanks for taking a look — the box below is ticked so this won’t pop
						up again.
					</p>
				)}

				<label className="mt-4 flex items-center gap-2 text-xs text-ink-muted">
					<input
						type="checkbox"
						checked={dontShowAgain}
						onChange={(e) => setDontShowAgain(e.target.checked)}
						className="accent-accent"
					/>
					Don’t show this again
				</label>
			</div>
		</div>
	);
}
