import { db } from './firebase'
import { collection, getDocs } from 'firebase/firestore'

async function checkInventory() {
  const snap = await getDocs(collection(db, 'inventory'))
  console.log('Total items:', snap.size)
  snap.forEach(doc => {
    console.log(`ID: ${doc.id}, Name: ${doc.data().name}, Type: ${doc.data().type}, Disabled: ${doc.data().disabled}`)
  })
}

checkInventory()
