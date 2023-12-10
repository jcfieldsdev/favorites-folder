/******************************************************************************
 * Favorites Folder                                                           *
 *                                                                            *
 * Copyright (C) 2022 J.C. Fields (jcfields@jcfields.dev).                    *
 *                                                                            *
 * Permission to use, copy, modify, and/or distribute this software for any   *
 * purpose with or without fee is hereby granted, provided that the above     *
 * copyright notice and this permission notice appear in all copies.          *
 *                                                                            *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES   *
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF           *
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR    *
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES     *
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN      *
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR *
 * IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.                *
 ******************************************************************************/

"use strict";

/*
 * constants
 */

const DEFAULT_VISITS = 1;
const DEFAULT_RECENT = 5;

const TAB_ALL = -1;
const TAB_PARENT = -2;

// longer period/more results are more accurate but slower
const HISTORY_DAYS = 30;
const HISTORY_RESULTS = 10000;

const FAVICON_SITE = "https://www.google.com/s2/favicons?domain=";

const FIREFOX_BOOKMARKS_ROOT = "root________";
const FIREFOX_BOOKMARKS_TOOLBAR_ID = "toolbar_____";

const CHROME_BOOKMARKS_ROOT = "0";
const CHROME_BOOKMARKS_TOOLBAR_ID = "1";

const IS_FIREFOX = window.browser != undefined;

const BOOKMARKS_ROOT = IS_FIREFOX
                     ? FIREFOX_BOOKMARKS_ROOT
                     : CHROME_BOOKMARKS_ROOT;
const BOOKMARKS_TOOLBAR_ID = IS_FIREFOX
                           ? FIREFOX_BOOKMARKS_TOOLBAR_ID
                           : CHROME_BOOKMARKS_TOOLBAR_ID;

/*
 * initialization
 */


window.addEventListener("load", function() {
	const favorites = new Favorites();

	window.addEventListener("focus", function() {
		favorites.reload();
	});
	window.addEventListener("blur", function() {
		favorites.saveOptions();
	});

	document.addEventListener("click", function(event) {
		const element = event.target;

		if (element.matches(".tab")) {
			const n = Number(element.value);

			if (element.classList.contains("folder")) {
				favorites.openFolder(n);
			} else if (element.classList.contains("parent")) {
				favorites.openParent();
			} else {
				favorites.selectTab(n);
			}

			element.blur();
		}

		if (element.matches(".pin")) {
			const n = Number(element.closest(".favorite").dataset.index);
			favorites.getFavorite(n).pin(element.value);
			favorites.reloadFavorite(n);

			favorites.saveOptions();
		}
	});
	document.addEventListener("input", function(event) {
		const element = event.target;

		if (element.matches(".visits")) {
			const n = Number(element.closest(".favorite").dataset.index);
			favorites.getFavorite(n).visitsLength = Number(element.value);
			favorites.reloadFavorite(n);

			favorites.saveOptions();
		}

		if (element.matches(".recent")) {
			const n = Number(element.closest(".favorite").dataset.index);
			favorites.getFavorite(n).recentLength = Number(element.value);
			favorites.reloadFavorite(n);

			favorites.saveOptions();
		}
	});
});

function $(selector) {
	return document.querySelector(selector);
}

function $$(selector) {
	return Array.from(document.querySelectorAll(selector));
}

/*
 * Favorites prototype
 */

function Favorites() {
	this.favorites = [];
	this.historyItems = null;

	this.parentId = BOOKMARKS_ROOT;
	this.selectedId = BOOKMARKS_TOOLBAR_ID;
	this.selectedTab = TAB_ALL;
}

Favorites.prototype.loadOptions = function() {
	return chrome.storage.local.get().then(function(options) {
		if (Object.keys(options).length == 0) {
			return;
		}

		const {sites, selectedId, parentId, selectedTab} = options;

		this.parentId    = parentId    ?? BOOKMARKS_ROOT;
		this.selectedId  = selectedId  ?? BOOKMARKS_TOOLBAR_ID;
		this.selectedTab = selectedTab ?? TAB_ALL;

		for (const favorite of this.favorites) {
			if (sites[favorite.id] != undefined) {
				const {pinned, visitsLength, recentLength} = sites[favorite.id];
				favorite.pinned = new Set(pinned);
				favorite.visitsLength = visitsLength;
				favorite.recentLength = recentLength;
			}
		}
	}.bind(this));
};

Favorites.prototype.saveOptions = function() {
	const sites = {};

	for (const favorite of this.favorites) {
		if (!favorite.isFolder) {
			sites[favorite.id] = {
				pinned:       Array.from(favorite.pinned),
				visitsLength: favorite.visitsLength,
				recentLength: favorite.recentLength
			};
		}
	}

	const options = {
		sites:       sites,
		parentId:    this.parentId,
		selectedId:  this.selectedId,
		selectedTab: this.selectedTab
	};

	return chrome.storage.local.set(options);
};

Favorites.prototype.reload = function() {
	return this.loadOptions().then(function() {
		return this.openFolderById(this.selectedId);
	}.bind(this)).then(function() {
		this.selectTab(this.selectedTab);
	}.bind(this));
};

Favorites.prototype.openParent = function() {
	return this.openFolderById(this.parentId).then(function() {
		this.selectTab(TAB_ALL);
	}.bind(this));
};

Favorites.prototype.openFolder = function(n=0) {
	if (this.favorites.length > 0) {
		const folder = this.favorites[n];

		return this.loadFavorites(folder.children).then(function() {
			this.parentId = this.selectedId;
			this.selectedId = folder.id;

			this.createTabs();
			this.createFavorites();
			this.selectTab(TAB_ALL);
		}.bind(this));
	}
};

Favorites.prototype.openFolderById = function(id) {
	return chrome.bookmarks.getSubTree(id).then(function(nodes) {
		const node = nodes[0];

		return this.loadFavorites(node.children).then(function() {
			this.parentId = node.parentId;
			this.selectedId = node.id;

			this.createTabs();
			this.createFavorites();
		}.bind(this));
	}.bind(this));
};

Favorites.prototype.getFavorite = function(n=0) {
	return this.favorites[n];
};

Favorites.prototype.loadFavorites = function(favorites) {
	this.favorites = favorites.filter(function(node) {
		return node.type != "separator";
	}).map(function(node, n) {
		if (node.type == "bookmark" || node.children == undefined) {
			return new Favorite(node, n);
		}

		return new Folder(node, n);
	});

	return this.loadOptions().then(function() {
		return chrome.history.search({
			text:       "",
			startTime:  Date.now() - HISTORY_DAYS * 24*60*60*1000,
			endTime:    Date.now(),
			maxResults: HISTORY_RESULTS
		});
	}.bind(this)).then(function(historyItems) {
		this.historyItems = historyItems;
	}.bind(this));
};

Favorites.prototype.selectTab = function(n=0) {
	this.selectedTab = n;

	for (const element of $$(".tab")) {
		element.classList.toggle("selected", Number(element.value) == n);
	}

	for (const element of $$(".favorite")) {
		element.hidden = n != TAB_ALL && Number(element.dataset.index) != n;
	}

	$("#favorites").classList.toggle("all", n == TAB_ALL);
};

Favorites.prototype.createTabs = function() {
	const parent = document.createElement("ul");
	parent.id = "tabs";
	parent.append($("#all").content.cloneNode(true));

	if (this.parentId != BOOKMARKS_ROOT) {
		parent.append($("#parent").content.cloneNode(true));
	}

	for (const [n, favorite] of this.favorites.entries()) {
		const template = $("#tab").content.cloneNode(true);

		const button = template.querySelector("button");
		button.classList.toggle("folder", favorite.isFolder);
		button.value = n;
		button.textContent = favorite.title;

		if (!favorite.isFolder) {
			const favicon = IS_FIREFOX
			              ? getRemoteFavicon(favorite.url)
						  : getLocalFavicon(favorite.url);
			button.style.backgroundImage = `url(${favicon})`;
		}

		parent.append(template);
	}

	$("#tabs").replaceWith(parent);
	$("#emptyFolder").hidden = this.favorites.length > 0;

	function getLocalFavicon(favoriteUrl) {
		const faviconUrl = new URL(chrome.runtime.getURL("/_favicon/"));
		faviconUrl.searchParams.set("pageUrl", favoriteUrl.href);
		faviconUrl.searchParams.set("size", "32");

		return faviconUrl.toString();
	}

	function getRemoteFavicon(favoriteUrl) {
		return FAVICON_SITE + favoriteUrl.host;
	}
};

Favorites.prototype.createFavorites = function() {
	const parent = document.createElement("div");
	parent.id = "favorites";

	for (const [n, favorite] of this.favorites.entries()) {
		if (!favorite.isFolder) {
			const template = $("#favorite").content.cloneNode(true);

			const div = document.createElement("div");
			div.id = favorite.id;
			div.className = "favorite";
			div.dataset.index = n;

			const a = template.querySelector(".name");
			a.href = favorite.url;
			a.textContent = favorite.title;

			div.append(template);
			parent.append(div);
		}
	}

	$("#favorites").replaceWith(parent);

	for (const element of $$(".favorite")) {
		this.reloadFavorite(element.dataset.index);
	}
};

Favorites.prototype.reloadFavorite = function(n=0) {
	const element = $$(".favorite").find(function(element) {
		return element.dataset.index == n;
	});
	const favorite = this.favorites[n];

	element.querySelector(".length.visits").value = favorite.visitsLength;
	element.querySelector(".length.recent").value = favorite.recentLength;

	favorite.filterHistory(this.historyItems);

	const pinnedList = document.createElement("ul");
	pinnedList.classList.add("pinned", "links");

	for (const historyItem of favorite.pinnedHistory) {
		pinnedList.append(createListItem(historyItem));
	}

	const visitsList = document.createElement("ul");
	visitsList.classList.add("visits", "links");

	for (const historyItem of favorite.visitsHistory) {
		visitsList.append(createListItem(historyItem));
	}

	const recentList = document.createElement("ul");
	recentList.classList.add("recent", "links");

	for (const historyItem of favorite.recentHistory) {
		recentList.append(createListItem(historyItem));
	}

	element.querySelector(".pinned.links").replaceWith(pinnedList);
	element.querySelector(".visits.links").replaceWith(visitsList);
	element.querySelector(".recent.links").replaceWith(recentList);

	function createListItem(historyItem) {
		const template = $("#item").content.cloneNode(true);

		template.querySelector("a").href = historyItem.url;
		template.querySelector(".title").textContent = historyItem.title
			|| historyItem.url;
		template.querySelector(".url").textContent = historyItem.url;

		const pin = template.querySelector(".pin");
		pin.value = historyItem.id;
		pin.classList.toggle("selected", favorite.pinned.has(historyItem.id));

		return template;
	}
};

/*
 * Favorite prototype
 */

function Favorite(node, n) {
	this.n = n;
	this.isFolder = false;

	const {id, title, url} = node;

	this.id = id;
	this.title = title;
	this.url = new URL(url);

	this.pinned = new Set();
	this.visitsLength = DEFAULT_VISITS;
	this.recentLength = DEFAULT_RECENT;

	this.pinnedHistory = [];
	this.visitsHistory = [];
	this.recentHistory = [];
}

Favorite.prototype.filterHistory = function(allHistoryItems) {
	const url = this.url.protocol + "//" + this.url.host + "/";

	const historyItems = allHistoryItems.filter(function(historyItem) {
		return historyItem.url.startsWith(url)
			&& historyItem.url != url;
	});

	const pinnedHistoryItems = [];
	const unpinnedHistoryItems = [];

	for (const historyItem of historyItems) {
		if (this.pinned.has(historyItem.id)) {
			pinnedHistoryItems.push(historyItem);
		} else {
			unpinnedHistoryItems.push(historyItem);
		}
	}

	this.pinnedHistory = pinnedHistoryItems.sort(function(a, b) {
		if (a.title == null) {
			return 1;
		}

		if (b.title == null) {
			return -1;
		}

		return a.title.localeCompare(b.title);
	});

	this.visitsHistory = unpinnedHistoryItems.sort(function(a, b) {
		return b.visitCount - a.visitCount;
	}).slice(0, this.visitsLength);

	this.recentHistory = unpinnedHistoryItems.filter(function(historyItem) {
		// skips items already in the most visited list
		return !this.visitsHistory.includes(historyItem);
	}.bind(this)).sort(function(a, b) {
		return b.lastVisitTime - a.lastVisitTime;
	}).slice(0, this.recentLength);
};

Favorite.prototype.pin = function(id) {
	if (this.pinned.has(id)) {
		this.pinned.delete(id);
	} else {
		this.pinned.add(id);
	}
};

/*
 * Folder prototype
 */

function Folder(node, n) {
	this.n = n;
	this.isFolder = true;

	const {id, title, children} = node;

	this.id = id;
	this.title = title;
	this.children = children;
}