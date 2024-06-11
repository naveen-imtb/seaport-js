import { BigNumberish, toBeHex, TransactionReceipt, parseEther } from "ethers";
import { ethers } from "hardhat";
import { Item, Order, OrderStatus } from "../../src/types";
import { balanceOf } from "../../src/utils/balance";

import {
  getPresentItemAmount,
  TimeBasedItemParams,
} from "../../src/utils/item";
import { expect } from "chai";
import {
  mapInputItemToOfferItem,
  mapOrderAmountsFromFilledStatus,
  mapOrderAmountsFromUnitsToFill,
} from "../../src/utils/order";
import { TipInputItem } from "../../lib/types";
import { getMaximumSizeForOrder } from "../../lib/utils/item";
import { adjustTipsForPartialFills } from "../../lib/utils/order";

export const setBalance = async (
  address: string,
  amountEth = toBeHex(parseEther("10000")).replace("0x0", "0x"),
) => {
  await ethers.provider.send("hardhat_setBalance", [
    address,
    toBeHex(parseEther(amountEth)).replace("0x0", "0x"),
  ]);
};

export const getBalancesForFulfillOrder = async (
  order: Order,
  fulfillerAddress: string,
) => {
  const { offer, consideration, offerer } = order.parameters;

  const relevantAddresses = Array.from(
    new Set([
      offerer,
      fulfillerAddress,
      ...consideration.map((item) => item.recipient),
    ]),
  );

  const ownerToTokenToIdentifierBalances: Record<
    string,
    Record<string, Record<string, { balance: bigint; item: Item }>>
  > = {};

  relevantAddresses.forEach((address) => {
    ownerToTokenToIdentifierBalances[address] = {};
  });

  // Just prepopulate all the keys so we can do an async map
  for (const item of [...offer, ...consideration]) {
    for (const address of relevantAddresses) {
      ownerToTokenToIdentifierBalances[address] = {
        ...ownerToTokenToIdentifierBalances[address],
        [item.token]: {
          [item.identifierOrCriteria]: {
            item,
            balance: 0n,
          },
        },
      };
    }
  }

  await Promise.all(
    [...offer, ...consideration].map((item) =>
      Promise.all([
        ...relevantAddresses.map(async (address) => {
          ownerToTokenToIdentifierBalances[address][item.token][
            item.identifierOrCriteria
          ] = {
            item,
            balance: await balanceOf(address, item, ethers.provider),
          };
        }),
      ]),
    ),
  );

  return ownerToTokenToIdentifierBalances;
};

export const getBalancesForFulfillOrderV2 = async (
  order: Order,
  fulfillerAddress: string,
  tips?: TipInputItem[],
) => {
  const { offer, consideration, offerer } = order.parameters;

  const tipsAsConsiderationItems =
    tips?.map((tip) => ({
      ...mapInputItemToOfferItem(tip),
      recipient: tip.recipient,
    })) ?? [];

  const considerationsIncludingTips = [
    ...consideration,
    ...tipsAsConsiderationItems,
  ];

  const relevantAddresses = Array.from(
    new Set([
      offerer,
      fulfillerAddress,
      ...considerationsIncludingTips.map((item) => item.recipient),
    ]),
  );

  const ownerToTokenToIdentifierBalances: Record<
    string,
    Record<string, Record<string, { balance: bigint; item: Item }>>
  > = {};

  relevantAddresses.forEach((address) => {
    ownerToTokenToIdentifierBalances[address] = {};
  });

  // Just prepopulate all the keys so we can do an async map
  for (const item of [...offer, ...considerationsIncludingTips]) {
    for (const address of relevantAddresses) {
      ownerToTokenToIdentifierBalances[address] = {
        ...ownerToTokenToIdentifierBalances[address],
        [item.token]: {
          [item.identifierOrCriteria]: {
            item,
            balance: 0n,
          },
        },
      };
    }
  }

  await Promise.all(
    [...offer, ...considerationsIncludingTips].map((item) =>
      Promise.all([
        ...relevantAddresses.map(async (address) => {
          ownerToTokenToIdentifierBalances[address][item.token][
            item.identifierOrCriteria
          ] = {
            item,
            balance: await balanceOf(address, item, ethers.provider),
          };
        }),
      ]),
    ),
  );

  return ownerToTokenToIdentifierBalances;
};

// export const getBalancesForTips = async (tips: TipInputItem[] = []) => {
//   const relevantAddresses = Array.from(
//     new Set([...tips.map((tip) => tip.recipient)]),
//   );
//
//   const ownerToTokenToIdentifierBalances: Record<
//     string,
//     Record<string, Record<string, { balance: bigint; item: TipInputItem }>>
//   > = {};
//
//   relevantAddresses.forEach((address) => {
//     ownerToTokenToIdentifierBalances[address] = {};
//   });
//
//   // Just prepopulate all the keys so we can do an async map
//   for (const item of [...tips]) {
//     for (const address of relevantAddresses) {
//       const token = item.token ? item.token : "";
//       const identifier = "identifier" in item ? item.identifier : "0";
//
//       ownerToTokenToIdentifierBalances[address] = {
//         ...ownerToTokenToIdentifierBalances[address],
//         [token]: {
//           [identifier]: {
//             item,
//             balance: 0n,
//           },
//         },
//       };
//     }
//   }
//
//   await Promise.all(
//     [...tips].map((item) =>
//       Promise.all([
//         ...relevantAddresses.map(async (address) => {
//           const token = item.token ? item.token : "";
//           const identifier = "identifier" in item ? item.identifier : "0";
//
//           ownerToTokenToIdentifierBalances[address][token][identifier] = {
//             item,
//             balance: await balanceOf(address, item, ethers.provider),
//           };
//         }),
//       ]),
//     ),
//   );
//
//   return ownerToTokenToIdentifierBalances;
// };

export const verifyBalancesAfterFulfill = async ({
  ownerToTokenToIdentifierBalances,
  order,
  unitsToFill,
  orderStatus,
  fulfillReceipt,
  fulfillerAddress,
  timeBasedItemParams,
}: {
  ownerToTokenToIdentifierBalances: Record<
    string,
    Record<string, Record<string, { balance: bigint; item: Item }>>
  >;
  order: Order;
  orderStatus?: OrderStatus;
  unitsToFill?: BigNumberish;
  fulfillReceipt: TransactionReceipt;
  fulfillerAddress: string;
  timeBasedItemParams?: TimeBasedItemParams;
}) => {
  const totalFilled = orderStatus?.totalFilled ?? 0n;
  const totalSize = orderStatus?.totalSize ?? 0n;

  const orderWithAdjustedFills = unitsToFill
    ? mapOrderAmountsFromUnitsToFill(order, {
        unitsToFill,
        totalSize,
      })
    : mapOrderAmountsFromFilledStatus(order, {
        totalFilled,
        totalSize,
      });

  const { offer, consideration, offerer } = orderWithAdjustedFills.parameters;

  // Offer items are depleted
  offer.forEach((item) => {
    const exchangedAmount = getPresentItemAmount({
      startAmount: item.startAmount,
      endAmount: item.endAmount,
      timeBasedItemParams: timeBasedItemParams
        ? { ...timeBasedItemParams, isConsiderationItem: false }
        : undefined,
    });

    ownerToTokenToIdentifierBalances[offerer][item.token][
      item.identifierOrCriteria
    ] = {
      item,
      balance:
        ownerToTokenToIdentifierBalances[offerer][item.token][
          item.identifierOrCriteria
        ].balance - exchangedAmount,
    };

    console.log(
      `ownerToTokenToIdentifierBalances[offerer][item.token][item.identifierOrCriteria] ${stringifyObj(ownerToTokenToIdentifierBalances[offerer][item.token][item.identifierOrCriteria])}`,
    );

    ownerToTokenToIdentifierBalances[fulfillerAddress][item.token][
      item.identifierOrCriteria
    ] = {
      item,
      balance:
        ownerToTokenToIdentifierBalances[fulfillerAddress][item.token][
          item.identifierOrCriteria
        ].balance + exchangedAmount,
    };

    console.log(
      `ownerToTokenToIdentifierBalances[fulfillerAddress][item.token][item.identifierOrCriteria] ${stringifyObj(ownerToTokenToIdentifierBalances[fulfillerAddress][item.token][item.identifierOrCriteria])}`,
    );
  });

  consideration.forEach((item) => {
    const exchangedAmount = getPresentItemAmount({
      startAmount: item.startAmount,
      endAmount: item.endAmount,
      timeBasedItemParams: timeBasedItemParams
        ? { ...timeBasedItemParams, isConsiderationItem: true }
        : undefined,
    });

    ownerToTokenToIdentifierBalances[fulfillerAddress][item.token][
      item.identifierOrCriteria
    ] = {
      item,
      balance:
        ownerToTokenToIdentifierBalances[fulfillerAddress][item.token][
          item.identifierOrCriteria
        ].balance - exchangedAmount,
    };

    console.log(
      `ownerToTokenToIdentifierBalances[fulfillerAddress][item.token][item.identifierOrCriteria] ${stringifyObj(ownerToTokenToIdentifierBalances[fulfillerAddress][item.token][item.identifierOrCriteria])}`,
    );

    ownerToTokenToIdentifierBalances[item.recipient][item.token][
      item.identifierOrCriteria
    ] = {
      item,
      balance:
        ownerToTokenToIdentifierBalances[item.recipient][item.token][
          item.identifierOrCriteria
        ].balance + exchangedAmount,
    };

    console.log(
      `ownerToTokenToIdentifierBalances[item.recipient][item.token][item.identifierOrCriteria] ${stringifyObj(ownerToTokenToIdentifierBalances[item.recipient][item.token][item.identifierOrCriteria])}`,
    );
  });

  // Take into account gas costs
  if (ownerToTokenToIdentifierBalances[fulfillerAddress][ethers.ZeroAddress]) {
    ownerToTokenToIdentifierBalances[fulfillerAddress][ethers.ZeroAddress][0] =
      {
        ...ownerToTokenToIdentifierBalances[fulfillerAddress][
          ethers.ZeroAddress
        ][0],
        balance:
          ownerToTokenToIdentifierBalances[fulfillerAddress][
            ethers.ZeroAddress
          ][0].balance -
          fulfillReceipt.gasUsed * fulfillReceipt.gasPrice,
      };

    console.log(
      `After accounting for gas ownerToTokenToIdentifierBalances[fulfillerAddress][ethers.ZeroAddress][0] ${stringifyObj(ownerToTokenToIdentifierBalances[fulfillerAddress][ethers.ZeroAddress][0])}`,
    );
  }

  await Promise.all([
    ...Object.entries(ownerToTokenToIdentifierBalances).map(
      ([owner, tokenToIdentifierBalances]) =>
        Promise.all([
          ...Object.values(tokenToIdentifierBalances).map(
            (identifierToBalance) =>
              Promise.all([
                ...Object.values(identifierToBalance).map(
                  async ({ balance, item }) => {
                    const actualBalance = await balanceOf(
                      owner,
                      item,
                      ethers.provider,
                    );

                    console.log(
                      `expected balance ${balance} actual balance ${actualBalance}`,
                    );

                    expect(balance).equal(actualBalance);
                  },
                ),
              ]),
          ),
        ]),
    ),
  ]);
};

export const verifyBalancesAfterFulfillV2 = async ({
  ownerToTokenToIdentifierBalances,
  order,
  unitsToFill,
  orderStatus,
  fulfillReceipt,
  fulfillerAddress,
  timeBasedItemParams,
  tips,
}: {
  ownerToTokenToIdentifierBalances: Record<
    string,
    Record<string, Record<string, { balance: bigint; item: Item }>>
  >;
  order: Order;
  orderStatus?: OrderStatus;
  unitsToFill?: BigNumberish;
  fulfillReceipt: TransactionReceipt;
  fulfillerAddress: string;
  timeBasedItemParams?: TimeBasedItemParams;
  tips?: TipInputItem[];
}) => {
  const tipsAsConsiderationItems =
    tips?.map((tip) => ({
      ...mapInputItemToOfferItem(tip),
      recipient: tip.recipient,
    })) ?? [];

  // Max total amount to fulfill for scaling
  const maxUnits = getMaximumSizeForOrder(order);

  const adjustedTips = adjustTipsForPartialFills(
    tipsAsConsiderationItems,
    unitsToFill || 1,
    maxUnits,
  );

  const totalFilled = orderStatus?.totalFilled ?? 0n;
  const totalSize = orderStatus?.totalSize ?? 0n;

  const orderWithAdjustedFills = unitsToFill
    ? mapOrderAmountsFromUnitsToFill(order, {
        unitsToFill,
        totalSize,
      })
    : mapOrderAmountsFromFilledStatus(order, {
        totalFilled,
        totalSize,
      });

  const { offer, consideration, offerer } = orderWithAdjustedFills.parameters;

  const considerationIncludingTips = [...consideration, ...adjustedTips];

  // Offer items are depleted
  offer.forEach((item) => {
    const exchangedAmount = getPresentItemAmount({
      startAmount: item.startAmount,
      endAmount: item.endAmount,
      timeBasedItemParams: timeBasedItemParams
        ? { ...timeBasedItemParams, isConsiderationItem: false }
        : undefined,
    });

    ownerToTokenToIdentifierBalances[offerer][item.token][
      item.identifierOrCriteria
    ] = {
      item,
      balance:
        ownerToTokenToIdentifierBalances[offerer][item.token][
          item.identifierOrCriteria
        ].balance - exchangedAmount,
    };

    console.log(
      `ownerToTokenToIdentifierBalances[offerer][item.token][item.identifierOrCriteria] ${stringifyObj(ownerToTokenToIdentifierBalances[offerer][item.token][item.identifierOrCriteria])}`,
    );

    ownerToTokenToIdentifierBalances[fulfillerAddress][item.token][
      item.identifierOrCriteria
    ] = {
      item,
      balance:
        ownerToTokenToIdentifierBalances[fulfillerAddress][item.token][
          item.identifierOrCriteria
        ].balance + exchangedAmount,
    };

    console.log(
      `ownerToTokenToIdentifierBalances[fulfillerAddress][item.token][item.identifierOrCriteria] ${stringifyObj(ownerToTokenToIdentifierBalances[fulfillerAddress][item.token][item.identifierOrCriteria])}`,
    );
  });

  considerationIncludingTips.forEach((item) => {
    const exchangedAmount = getPresentItemAmount({
      startAmount: item.startAmount,
      endAmount: item.endAmount,
      timeBasedItemParams: timeBasedItemParams
        ? { ...timeBasedItemParams, isConsiderationItem: true }
        : undefined,
    });

    ownerToTokenToIdentifierBalances[fulfillerAddress][item.token][
      item.identifierOrCriteria
    ] = {
      item,
      balance:
        ownerToTokenToIdentifierBalances[fulfillerAddress][item.token][
          item.identifierOrCriteria
        ].balance - exchangedAmount,
    };

    console.log(
      `ownerToTokenToIdentifierBalances[fulfillerAddress][item.token][item.identifierOrCriteria] ${stringifyObj(ownerToTokenToIdentifierBalances[fulfillerAddress][item.token][item.identifierOrCriteria])}`,
    );

    ownerToTokenToIdentifierBalances[item.recipient][item.token][
      item.identifierOrCriteria
    ] = {
      item,
      balance:
        ownerToTokenToIdentifierBalances[item.recipient][item.token][
          item.identifierOrCriteria
        ].balance + exchangedAmount,
    };

    console.log(
      `ownerToTokenToIdentifierBalances[item.recipient][item.token][item.identifierOrCriteria] ${stringifyObj(ownerToTokenToIdentifierBalances[item.recipient][item.token][item.identifierOrCriteria])}`,
    );
  });

  // Take into account gas costs
  if (ownerToTokenToIdentifierBalances[fulfillerAddress][ethers.ZeroAddress]) {
    ownerToTokenToIdentifierBalances[fulfillerAddress][ethers.ZeroAddress][0] =
      {
        ...ownerToTokenToIdentifierBalances[fulfillerAddress][
          ethers.ZeroAddress
        ][0],
        balance:
          ownerToTokenToIdentifierBalances[fulfillerAddress][
            ethers.ZeroAddress
          ][0].balance -
          fulfillReceipt.gasUsed * fulfillReceipt.gasPrice,
      };

    console.log(
      `After accounting for gas ownerToTokenToIdentifierBalances[fulfillerAddress][ethers.ZeroAddress][0] ${stringifyObj(ownerToTokenToIdentifierBalances[fulfillerAddress][ethers.ZeroAddress][0])}`,
    );
  }

  await Promise.all([
    ...Object.entries(ownerToTokenToIdentifierBalances).map(
      ([owner, tokenToIdentifierBalances]) =>
        Promise.all([
          ...Object.values(tokenToIdentifierBalances).map(
            (identifierToBalance) =>
              Promise.all([
                ...Object.values(identifierToBalance).map(
                  async ({ balance, item }) => {
                    const actualBalance = await balanceOf(
                      owner,
                      item,
                      ethers.provider,
                    );

                    console.log(
                      `expected balance ${balance} actual balance ${actualBalance}`,
                    );

                    expect(balance).equal(actualBalance);
                  },
                ),
              ]),
          ),
        ]),
    ),
  ]);
};

function stringifyObj(obj: any): string {
  return JSON.stringify(
    obj,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value), // return everything else unchanged
  );
}
