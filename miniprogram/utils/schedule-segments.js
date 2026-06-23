const TIME_SEGMENTS = [
  { key: "morning", label: "\u4e0a\u5348", firstPeriod: 1, lastPeriod: 4 },
  { key: "afternoon", label: "\u4e0b\u5348", firstPeriod: 5, lastPeriod: 8 },
  { key: "evening", label: "\u665a\u4e0a", firstPeriod: 9 }
];

function buildTimeSegments(periodRows) {
  return TIME_SEGMENTS.map((segment) => {
    const rows = periodRows.filter((period) => {
      const periodIndex = Number(period.period_index);
      return periodIndex >= segment.firstPeriod && (!segment.lastPeriod || periodIndex <= segment.lastPeriod);
    });

    if (!rows.length) {
      return null;
    }

    return {
      key: segment.key,
      label: segment.label,
      row: rows[0].row,
      span: rows.length,
      endRow: rows[rows.length - 1].row,
      rangeText: `${rows[0].startText}-${rows[rows.length - 1].endText}`
    };
  }).filter(Boolean);
}

function findTimeSegment(timeSegments, sourceRow) {
  return (
    timeSegments.find((segment) => sourceRow >= segment.row && sourceRow <= segment.endRow) ||
    timeSegments[timeSegments.length - 1] ||
    null
  );
}

function displayOrder(left, right, priorityTypes) {
  const leftPriority = priorityTypes.indexOf(left.type);
  const rightPriority = priorityTypes.indexOf(right.type);
  const normalizedLeftPriority = leftPriority === -1 ? priorityTypes.length : leftPriority;
  const normalizedRightPriority = rightPriority === -1 ? priorityTypes.length : rightPriority;
  if (normalizedLeftPriority !== normalizedRightPriority) {
    return normalizedLeftPriority - normalizedRightPriority;
  }
  return left.sortOrder - right.sortOrder;
}

function buildTimeBands(timeSegments, cards) {
  return timeSegments.map((segment) => {
    const cells = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const cellCards = cards
        .filter((card) => card.segmentKey === segment.key && card.dayIndex === dayIndex)
        .sort((left, right) => left.sortOrder - right.sortOrder);
      cells.push({
        key: `${segment.key}-${dayIndex}`,
        cards: cellCards
      });
    }
    return {
      ...segment,
      cells
    };
  });
}

function buildTimeBandCardGroups(cards, options = {}) {
  const priorityTypes = options.priorityTypes || [];
  const cardsByCell = {};
  cards.forEach((card) => {
    const cellKey = `${card.segmentKey}-${card.dayIndex}`;
    if (!cardsByCell[cellKey]) {
      cardsByCell[cellKey] = [];
    }
    cardsByCell[cellKey].push(card);
  });

  return Object.keys(cardsByCell).flatMap((cellKey) => {
    const cellCards = cardsByCell[cellKey]
      .slice()
      .sort((left, right) => left.sortOrder - right.sortOrder);
    const groups = [];
    let activeGroup = null;

    cellCards.forEach((card) => {
      const startMinute = Number(card.startMinute || card.sortOrder || 0);
      const endMinute = Math.max(startMinute + 1, Number(card.endMinute || startMinute + 1));
      if (!activeGroup || startMinute >= activeGroup.endMinute) {
        activeGroup = { items: [], endMinute };
        groups.push(activeGroup);
      }
      activeGroup.items.push(card);
      activeGroup.endMinute = Math.max(activeGroup.endMinute, endMinute);
    });

    return groups.map((group) => {
      const orderedItems = group.items.slice().sort((left, right) => displayOrder(left, right, priorityTypes));
      const main = orderedItems[0];
      const isStack = orderedItems.length > 1;
      return {
        key: orderedItems.map((item) => item.key).join("|"),
        segmentKey: main.segmentKey,
        dayIndex: main.dayIndex,
        sortOrder: Math.min(...orderedItems.map((item) => item.sortOrder)),
        isStack,
        itemCount: orderedItems.length,
        main,
        items: orderedItems,
        layerStyles: isStack
          ? orderedItems.slice(1, 3).map((item, index) => ({
            key: item.key,
            style: `left: ${(index + 1) * 7}rpx; top: ${(index + 1) * 7}rpx; right: -${(index + 1) * 7}rpx; bottom: -${(index + 1) * 7}rpx; background: ${item.background || main.background};`
          }))
          : []
      };
    });
  });
}

module.exports = {
  buildTimeSegments,
  findTimeSegment,
  buildTimeBands,
  buildTimeBandCardGroups
};
