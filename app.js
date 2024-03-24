const express = require('express')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const app = express()
app.use(express.json())

let db = null

const initializeDBAndServer = async () => {
  try {
    db = await open({filename: 'twitterClone.db', driver: sqlite3.Database})
    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000/')
    })
  } catch (error) {
    console.log(`DB Error: ${error.message}`)
    process.exit(1)
  }
}
initializeDBAndServer()

const authenticateToken = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }

  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'MY_SECRET_TOKEN', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        next()
      }
    })
  }
}

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const hashedPassword = await bcrypt.hash(password, 10)
  const selectUserQuery = `SELECT username, password, name, gender FROM user WHERE username = '${username}'`
  const dbUser = await db.get(selectUserQuery)

  if (dbUser === undefined) {
    const createUserQuery = `
      INSERT INTO 
        user (username, password,name, gender) 
      VALUES 
        (
          '${username}', 
          '${hashedPassword}',
          '${name}', 
          '${gender}'
          
        )`

    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      response.send(`User created successfully`)
      await db.run(createUserQuery)
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

//API 2
app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`
  const dbUser = await db.get(selectUserQuery)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      }
      const jwtToken = jwt.sign(payload, 'MY_SECRET_TOKEN')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

//API3
app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  const {username} = request
  const query = `SELECT user.username, tweet.tweet, tweet.date_time AS dateTime
            FROM tweet 
            LEFT JOIN follower ON tweet.user_id = follower.following_user_id 
            LEFT JOIN user ON tweet.user_id = user.user_id 
            WHERE follower.follower_user_id = (SELECT user_id FROM user WHERE username = '${username}')
            ORDER BY tweet.date_time DESC
            LIMIT 4`
  const tweets = await db.all(query)
  response.send(tweets)
})
//API 4
app.get('/user/following/', authenticateToken, async (request, response) => {
  const {username} = request
  const getQuery = `SELECT user.name 
      FROM user 
      INNER JOIN follower ON user.user_id = follower.following_user_id 
      WHERE follower.follower_user_id = (SELECT user_id FROM user WHERE username ='${username}')`
  const following = await db.all(getQuery)
  response.send(following)
})
//API 5
app.get('/user/followers/', authenticateToken, async (request, response) => {
  const {username} = request
  const getQuery = `SELECT name FROM user 
            WHERE user_id IN (SELECT follower_user_id FROM follower WHERE following_user_id = (SELECT user_id FROM user WHERE username ='${username}'))`
  const follower = await db.all(getQuery)
  response.send(follower)
})
// API 6
app.get('/tweets/:tweetId/', authenticateToken, async (request, response) => {
  const {username} = request
  const {tweetId} = request.params
  const getQuery = `
            SELECT tweet.tweet, SUM(like_id) AS likes, SUM(reply_id) AS replies, tweet.date_time AS dateTime
            FROM tweet 
            INNER JOIN like ON tweet.tweet_id = like.tweet_id 
            INNER JOIN reply ON tweet.tweet_id = reply.tweet_id 
            WHERE tweet.tweet_id = '${tweetId}' AND tweet.user_id IN 
            (SELECT following_user_id FROM follower WHERE follower_user_id = (SELECT user_id FROM user WHERE username = '${username}'))
        `
  const tweet = await db.get(getQuery)
  if (tweet) {
    response.send(tweet)
  } else {
    response.status(401)
    response.send('Invalid Request')
  }
})
// API 7
app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  async (request, response) => {
    const {username} = request
    const {tweetId} = request.params
    const getQuery = `
            SELECT user.username AS name 
            FROM like 
            INNER JOIN user ON like.user_id = user.user_id 
            WHERE like.tweet_id ='${tweetId}' AND like.user_id IN 
            (SELECT following_user_id FROM follower WHERE follower_user_id = (SELECT user_id FROM user WHERE username ='${username}' ))
        `
    const likes = await db.all(getQuery)
    if (likes.length > 0) {
      response.send({likes: likes.map(each => each.name)})
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)
//API 8

app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  async (request, response) => {
    const {username} = request
    const {tweetId} = request.params
    const getQuery = `
      SELECT user.user_id
      FROM user
      INNER JOIN tweet ON user.user_id = tweet.user_id
      INNER JOIN follower ON user.user_id = follower.following_user_id
      WHERE tweet.tweet_id = '${tweetId}' AND follower.follower_user_id = (
        SELECT user_id FROM user WHERE username = '${username}'
      )`
    const following = await db.get(getQuery)
    if (!following) {
      response.status(401)
      response.send('Invalid Request')
    }
    const repliesQuery = `
      SELECT user.name, reply.reply
      FROM reply
      INNER JOIN user ON reply.user_id = user.user_id
      WHERE reply.tweet_id = '${tweetId}'
    `
    const replies = await db.all(repliesQuery)
    response.send(replies)
  },
)

//API 9

app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const {username} = request
  const getQuery = `
      SELECT tweet.tweet, COUNT(like_id) AS likes, COUNT(reply_id) AS replies, tweet.date_time AS dateTime
      FROM tweet 
      LEFT JOIN like ON tweet.tweet_id = like.tweet_id 
      LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id 
      WHERE tweet.user_id = (SELECT user_id FROM user WHERE username ='${username}')
      GROUP BY tweet.tweet_id
    `
  const tweets = await db.all(getQuery)
  response.send(tweets)
})

// API 10

app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const {username} = request
  const {tweet} = request.body
  const postQuery = `
      INSERT INTO tweet (tweet, user_id, date_time)
      VALUES ('${tweet}', (SELECT user_id FROM user WHERE username = '${username}'), datetime('now'))
    `
  const tweets = await db.run(postQuery)
  response.send('Created a Tweet')
})

// API 11
app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {username} = request
    try {
      const selectUserQuery = `
      SELECT user.username
      FROM tweet
      INNER JOIN user ON tweet.user_id = user.user_id
      WHERE tweet.tweet_id = '${tweetId}'`
      const tweetOwner = await db.get(selectUserQuery)

      if (!tweetOwner || tweetOwner.username !== username) {
        return response.status(401).send('Invalid Request')
      }

      await db.run('DELETE FROM tweet WHERE tweet_id = ?', [tweetId])
      response.send('Tweet Removed')
    } catch (error) {
      console.error(error)
      response.sendStatus(500)
    }
  },
)

module.exports = app
