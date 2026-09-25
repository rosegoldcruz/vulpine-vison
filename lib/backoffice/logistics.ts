import type { FreightQuote, MapRouteEstimate, MoneyValue } from './domain';

export type FreightGrounding =
  | {
      source: 'approved_quote';
      authoritative: true;
      amount: MoneyValue;
      quote: FreightQuote;
      supportingRoute?: MapRouteEstimate;
      message: string;
    }
  | {
      source: 'map_estimate';
      authoritative: false;
      amount?: MoneyValue;
      supportingRoute: MapRouteEstimate;
      message: string;
    }
  | {
      source: 'unavailable';
      authoritative: false;
      message: string;
    };

export function selectFreightGrounding(input: {
  approvedQuote?: FreightQuote | null;
  mapEstimate?: MapRouteEstimate | null;
}): FreightGrounding {
  if (input.approvedQuote?.status === 'approved') {
    return {
      source: 'approved_quote',
      authoritative: true,
      amount: input.approvedQuote.amount,
      quote: input.approvedQuote,
      ...(input.mapEstimate ? { supportingRoute: input.mapEstimate } : {}),
      message: 'Approved freight quote is authoritative; map distance is supporting logistics information only.',
    };
  }
  if (input.mapEstimate) {
    return {
      source: 'map_estimate',
      authoritative: false,
      ...(input.mapEstimate.estimatedFreight ? { amount: input.mapEstimate.estimatedFreight } : {}),
      supportingRoute: input.mapEstimate,
      message: 'Map-derived freight is an estimate and requires approval before it can become authoritative.',
    };
  }
  return {
    source: 'unavailable',
    authoritative: false,
    message: 'No approved freight quote or connected map estimate is available.',
  };
}
