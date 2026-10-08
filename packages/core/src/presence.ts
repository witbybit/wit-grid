/**
 * Presence: who else is in the grid and where. The app feeds peers in (from its own realtime
 * channel); the grid draws each one's cell cursor with a name tag, gliding as they move, and pulsing
 * while they edit. `flashCells` briefly highlights cells, e.g. when a peer's edit lands.
 */

export interface GridPresenceCell {
	rowId: string;
	field: string;
}

export interface GridPresencePeer {
	/** Stable per peer: a peer keeps its cursor element (and its glide) across updates. */
	id: string;
	name: string;
	/** Any CSS colour. */
	color: string;
	/** The peer's focused cell; null or absent hides their cursor. */
	cell?: GridPresenceCell | null;
	/** The peer is editing their cell: the cursor pulses. */
	editing?: boolean;
}

export interface GridCellFlash extends GridPresenceCell {
	/** Default: the theme accent. */
	color?: string;
}

export class PresenceStore {
	private peersList: readonly GridPresencePeer[] = [];
	private flashes: GridCellFlash[] = [];
	private readonly listeners = new Set<() => void>();

	public get peers(): readonly GridPresencePeer[] {
		return this.peersList;
	}

	public set(peers: readonly GridPresencePeer[]): void {
		this.peersList = peers.slice();
		this.notify();
	}

	public flash(cells: readonly GridCellFlash[]): void {
		if (cells.length === 0) return;
		this.flashes.push(...cells);
		this.notify();
	}

	/** Hands queued flashes to the renderer (each is drawn once). */
	public takeFlashes(): GridCellFlash[] {
		const taken = this.flashes;
		this.flashes = [];
		return taken;
	}

	public subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}
}
