// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.21;
import './Types.sol';

library LibraryFilter {
  using Counters for Counters.Counter;

  function isValid(AssetFilter storage filter) public view returns (bool) {
    return filter.createdAt > 0;
  }

  function create(
    uint[] calldata allow,
    uint[] calldata deny,
    bool isOnly,
    uint[] calldata inherits,
    State storage state
  ) public returns (uint) {
    state.filterCounter.increment();
    uint filterId = state.filterCounter.current();
    AssetFilter storage filter = state.filters[filterId];
    filter.createdAt = block.timestamp;
    filter.isOnly = isOnly;
    require(allow.length > 0 || deny.length > 0, 'allow or deny is empty');
    if (isOnly) {
      require(allow.length > 0, 'allow must be non-empty');
      require(deny.length == 0, 'deny must be empty');
    }
    checkAssetIds(allow, state);
    checkAssetIds(deny, state);
    for (uint i = 0; i < allow.length; i++) {
      require(filter.allow[allow[i]] == false, 'duplicate allow');
      filter.allow[allow[i]] = true;
    }
    for (uint i = 0; i < deny.length; i++) {
      require(filter.deny[deny[i]] == false, 'duplicate deny');
      require(filter.allow[deny[i]] == false, 'deny conflicts with allow');
      filter.deny[deny[i]] = true;
    }
    for (uint i = 0; i < inherits.length; i++) {
      AssetFilter storage inheritedFilter = state.filters[inherits[i]];
      require(isValid(inheritedFilter), 'invalid inherited filter');
    }
    return filterId;
  }

  function checkAssetIds(
    uint[] calldata ids,
    State storage state
  ) internal view {
    for (uint i = 0; i < ids.length; i++) {
      uint assetId = ids[i];
      assert(assetId > LAST_PREALLOCATED_ASSET_ID);
      Asset memory asset = state.assets[assetId];
      assert(asset.tokenContract != ETH_ADDRESS);
    }
  }

  function isAllowed(
    AssetFilter storage filter,
    uint assetId,
    State storage state
  ) public returns (bool) {
    if (filter.allow[assetId]) {
      return true;
    }
    bool isOnly = filter.isOnly;
    if (!isOnly && filter.deny[assetId]) {
      return false;
    }
    for (uint i = 0; i < filter.inherits.length; i++) {
      uint filterId = filter.inherits[i];
      Allowed allowed = isInheritedAllowed(filterId, assetId, isOnly, state);
      if (allowed == Allowed.ALLOWED) {
        return true;
      } else if (allowed == Allowed.DENIED) {
        return false;
      }
    }
    return !isOnly;
  }

  enum Allowed {
    ALLOWED,
    DENIED,
    NEUTRAL
  }

  function isInheritedAllowed(
    uint filterId,
    uint assetId,
    bool isOnly,
    State storage state
  ) internal returns (Allowed) {
    AssetFilter storage filter = state.filters[filterId];
    assert(isValid(filter));
    if (filter.allow[assetId]) {
      return Allowed.ALLOWED;
    }
    if (!isOnly && filter.deny[assetId]) {
      return Allowed.DENIED;
    }
    for (uint i = 0; i < filter.inherits.length; i++) {
      uint inheritsId = filter.inherits[i];
      Allowed allowed = isInheritedAllowed(inheritsId, assetId, isOnly, state);
      if (allowed == Allowed.ALLOWED) {
        return Allowed.ALLOWED;
      } else if (allowed == Allowed.DENIED) {
        return Allowed.DENIED;
      }
    }
    return Allowed.NEUTRAL;
  }
}
