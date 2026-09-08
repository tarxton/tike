import { availableBrands } from '@tike/db';

const all = await availableBrands();
console.log(`brands with in-stock offers: ${all.length}`);
console.log(
  `shown as chips today (top 12): ${all
    .slice(0, 12)
    .map((b) => b.brand)
    .join(', ')}`,
);
console.log(`\nhidden (${all.length - 12}):`);
console.log(
  all
    .slice(12)
    .map((b) => `${b.brand} ${b.count}`)
    .join(' · '),
);

const tail = all.slice(12).reduce((n, b) => n + b.count, 0);
const total = all.reduce((n, b) => n + b.count, 0);
console.log(
  `\ngroups behind hidden brands: ${tail} of ${total} (${Math.round((tail / total) * 100)}%)`,
);
