import { db } from '../firebase'
import { collection, addDoc } from 'firebase/firestore'

async function seedMojaditos() {
  console.log('Seeding Mojaditos...')
  
  // 1. Add Pan Flavors
  const panFlavors = [
    { name: 'Pan de Chocolate', icon: '🍫', type: 'flavor', category: 'mojadito_pan' },
    { name: 'Pan de Vainilla', icon: '🍦', type: 'flavor', category: 'mojadito_pan' }
  ]
  
  for (const f of panFlavors) {
    await addDoc(collection(db, 'inventory'), f)
  }

  // 2. Add Toppings
  const toppings = [
    { name: 'Fresa', icon: '🍓', type: 'flavor', category: 'mojadito_topping' },
    { name: 'Nuez', icon: '🥜', type: 'flavor', category: 'mojadito_topping' },
    { name: 'Chocolate', icon: '🍫', type: 'flavor', category: 'mojadito_topping' },
    { name: 'Chispas', icon: '✨', type: 'flavor', category: 'mojadito_topping' }
  ]

  for (const t of toppings) {
    await addDoc(collection(db, 'inventory'), t)
  }

  // 3. Add Mojaditos Product
  const mojaditoProduct = {
    name: 'Mojaditos (3 leches)',
    icon: '🍰',
    type: 'product',
    price: 35, // Adjust as needed
    description: 'Deliciosos pastelitos bañados en tres leches.',
    optionGroups: [
      { label: 'Elige el sabor de pan', category: 'mojadito_pan' },
      { label: 'Elige tu topping', category: 'mojadito_topping' }
    ]
  }

  await addDoc(collection(db, 'inventory'), mojaditoProduct)
  
  console.log('Mojaditos seeded successfully!')
}

seedMojaditos()
