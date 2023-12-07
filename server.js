import { extract } from '@extractus/article-extractor'
import express from 'express'

const app = express()
const port = 3000

app.use(express.json())

app.post('/', async (req, res) => {
  console.log(req.body);
  const data = req.body;
  
  try {
    const article = await extract(data.link)
    res.json(article)
  } catch (error) {
    res.json({ error })
  }
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})