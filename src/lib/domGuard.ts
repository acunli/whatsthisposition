/**
 * Keeps a page that the browser has translated from breaking. Chrome's (and Edge's, Safari's)
 * page translation replaces text nodes with its own <font> elements; React still holds the old
 * nodes, and on its next change asks the page to insert before, or remove, a node that is no
 * longer there. The browser throws NotFoundError and the page falls to its error screen: on the
 * review page that was every few moves, for anyone reading it translated (facebook/react#11538).
 *
 * DOM_GUARD_SCRIPT (inlined in the root layout, before React starts) makes those two calls
 * forgiving: removing a node that has already left does nothing, and inserting before one that
 * has left appends instead. Every other call is untouched. Plain ES5, no dependencies.
 */
export const DOM_GUARD_SCRIPT = `(function(){if(typeof Node!=="function"||!Node.prototype)return;var r=Node.prototype.removeChild,i=Node.prototype.insertBefore;Node.prototype.removeChild=function(c){if(c&&c.parentNode!==this){if(c.parentNode)c.parentNode.removeChild(c);return c}return r.apply(this,arguments)};Node.prototype.insertBefore=function(n,b){if(b&&b.parentNode!==this)return i.call(this,n,null);return i.apply(this,arguments)}})()`;
