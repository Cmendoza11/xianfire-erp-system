const PAGE_LIMITS = [50, 100, 150, 200];

// Grid pagination: first page, current page and last page with ellipses between.
export function buildPagination({ total, page, limit }) {
  const lastPage = Math.ceil(total / limit);
  return {
    hasPrev: page > 1,
    hasNext: page * limit < total,
    prevPage: page - 1,
    nextPage: page + 1,
    page,
    lastPage,
    showFirst: page > 1,
    showLeadingEllipsis: page >= 3,
    showTrailingEllipsis: page < lastPage - 1,
    showLast: page * limit < total,
    limits: PAGE_LIMITS.map((value) => ({ value, selected: value === limit })),
    limitIsCustom: !PAGE_LIMITS.includes(limit),
    limit
  };
}

export function positiveInt(value, fallback) {
  const n = parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
