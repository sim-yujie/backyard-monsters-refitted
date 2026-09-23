import {
  MAX_BOOKMARKS,
  decodeBookmarks,
  normaliseBookmarkName,
  saveBookmarks,
  type Bookmark,
} from "@/api/bookmarks";
import { getStoredBookmarks } from "@/api/auth";

/**
 * The player's bookmark list, with the save behaviour around it.
 *
 * `savebookmarks` replaces the whole list; there is no add or remove endpoint.
 * So every change is applied locally first and pushed as a full list, and a
 * failed push rolls the local list back. Doing it the other way round would
 * leave the map showing a bookmark the server never accepted.
 *
 * The rules the Flash client enforced are kept, because the same account can
 * still be used from it: at most 8, names trimmed to 20 characters, and no two
 * bookmarks on one cell (MapRoom.as:442-478).
 */
export interface BookmarksOptions {
  onError: (message: string) => void;
  /** Fired when the list changed on its own, i.e. a failed save rolled back. */
  onChange: () => void;
}

export class Bookmarks {
  private list: Bookmark[];

  constructor(private readonly options: BookmarksOptions) {
    this.list = decodeBookmarks(getStoredBookmarks());
  }

  get all(): readonly Bookmark[] {
    return this.list;
  }

  get isFull(): boolean {
    return this.list.length >= MAX_BOOKMARKS;
  }

  has(x: number, y: number): boolean {
    return this.list.some((bookmark) => bookmark.x === x && bookmark.y === y);
  }

  /**
   * Adds a bookmark and persists the list.
   *
   * Returns the reason it was refused, or null when it was accepted. The
   * network write happens after the local change and is not awaited by the
   * caller: the list is already correct on screen either way.
   */
  add(x: number, y: number, name: string): string | null {
    if (this.isFull) return `You can keep ${MAX_BOOKMARKS} bookmarks.`;
    if (this.has(x, y)) return "That cell is already bookmarked.";

    const trimmed = normaliseBookmarkName(name) || `${x}, ${y}`;
    const previous = this.list;
    this.list = [...this.list, { x, y, name: trimmed }];
    void this.persist(previous);
    return null;
  }

  remove(index: number): void {
    if (index < 0 || index >= this.list.length) return;
    const previous = this.list;
    this.list = this.list.filter((_, at) => at !== index);
    void this.persist(previous);
  }

  private async persist(previous: Bookmark[]): Promise<void> {
    try {
      await saveBookmarks(this.list);
    } catch {
      // The server has the old list, so the screen must show the old list too.
      this.list = previous;
      this.options.onError("Bookmarks could not be saved. The change was undone.");
      this.options.onChange();
    }
  }
}
