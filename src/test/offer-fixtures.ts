import type { ProductOffer, ProductOffersResponse } from '../api/catalog/types'

export function offer(overrides: Partial<ProductOffer> = {}): ProductOffer {
  return {
    provider: 'yahoo', provider_item_id: 'tsukumo-y_cpu', name: 'AMD Ryzen 7 9800X3D', jan_code: '0730143315289',
    image: { id: 'cpu', small: { url: 'https://example.com/small.jpg', width: 76, height: 76 }, medium: null,
      preferred: { url: 'https://example.com/cpu.jpg', width: null, height: null } },
    seller: { id: 'tsukumo-y', name: 'ツクモ パソコン Yahoo!店', url: 'https://store.shopping.yahoo.co.jp/tsukumo-y/',
      image: { id: 'tsukumo-y_1', url: null }, is_best_seller: true, shop_key: 'tsukumo' },
    price: 59980, shipping: { code: 2, name: '送料無料' }, in_stock: true, condition: 'new',
    url: 'https://store.shopping.yahoo.co.jp/tsukumo-y/cpu.html', fetched_at: '2026-09-23T00:00:00.000Z', ...overrides,
  }
}

export function offersResponse(id = 372, offers = [offer()]): ProductOffersResponse {
  return { product: { id, name: 'AMD Ryzen 7 9800X3D' }, provider: 'yahoo',
    lookup: { status: 'complete', strategy: 'ean13_as_jan', reason: null }, offers }
}
