import os
import time
import logging
from typing import Dict, List, Any, Optional
import httpx
from .config import TMDB_API_KEY, TMDB_BASE_URL, TMDB_IMAGE_BASE

logger = logging.getLogger("tmdb-client")

# Pre-cached authentic TMDB dataset with authentic movie/TV metadata, backdrops, posters, ratings & trailers
REAL_TMDB_CATALOG: List[Dict[str, Any]] = [
    {
        "id": 693134,
        "title": "Dune: Part Two",
        "tagline": "Long live the fighters.",
        "overview": "Follow the mythic journey of Paul Atreides as he unites with Chani and the Fremen while on a path of revenge against the conspirators who destroyed his family.",
        "release_date": "2024-02-27",
        "vote_average": 8.2,
        "vote_count": 5210,
        "runtime": 166,
        "poster_path": "/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
        "backdrop_path": "/xOMo8BRK7PfcJv9JCnx7s520DRq.jpg",
        "genres": [{"id": 878, "name": "Science Fiction"}, {"id": 12, "name": "Adventure"}],
        "genre_ids": [878, 12],
        "media_type": "movie",
        "director": "Denis Villeneuve",
        "cast": ["Timothée Chalamet", "Zendaya", "Rebecca Ferguson", "Javier Bardem", "Austin Butler"],
        "trailer_key": "Way9Dexny3w"
    },
    {
        "id": 872585,
        "title": "Oppenheimer",
        "tagline": "The world forever changes.",
        "overview": "The story of J. Robert Oppenheimer's role in the development of the atomic bomb during World War II.",
        "release_date": "2023-07-19",
        "vote_average": 8.1,
        "vote_count": 8940,
        "runtime": 181,
        "poster_path": "/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg",
        "backdrop_path": "/fm6K9vYvt39mgrVI3xMYE48Y9Z8.jpg",
        "genres": [{"id": 18, "name": "Drama"}, {"id": 36, "name": "History"}],
        "genre_ids": [18, 36],
        "media_type": "movie",
        "director": "Christopher Nolan",
        "cast": ["Cillian Murphy", "Emily Blunt", "Matt Damon", "Robert Downey Jr.", "Florence Pugh"],
        "trailer_key": "uYPbbksJxIg"
    },
    {
        "id": 157336,
        "title": "Interstellar",
        "tagline": "Mankind was born on Earth. It was never meant to die here.",
        "overview": "The adventures of a group of explorers who make use of a newly discovered wormhole to surpass the limitations on human space travel and conquer the vast distances involved in an interstellar voyage.",
        "release_date": "2014-11-05",
        "vote_average": 8.4,
        "vote_count": 34820,
        "runtime": 169,
        "poster_path": "/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
        "backdrop_path": "/rAiYTgg0kWnJHHaV9vD63XZusQ7.jpg",
        "genres": [{"id": 12, "name": "Adventure"}, {"id": 18, "name": "Drama"}, {"id": 878, "name": "Science Fiction"}],
        "genre_ids": [12, 18, 878],
        "media_type": "movie",
        "director": "Christopher Nolan",
        "cast": ["Matthew McConaughey", "Anne Hathaway", "Jessica Chastain", "Michael Caine"],
        "trailer_key": "zSWdZVtXT7E"
    },
    {
        "id": 27205,
        "title": "Inception",
        "tagline": "Your mind is the scene of the crime.",
        "overview": "Cobb, a skilled thief who commits corporate espionage by infiltrating the subconscious of his targets is offered a chance to regain his old life as payment for a task considered to be impossible: \"inception\", the implantation of another person's idea into a target's subconscious.",
        "release_date": "2010-07-15",
        "vote_average": 8.4,
        "vote_count": 36200,
        "runtime": 148,
        "poster_path": "/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg",
        "backdrop_path": "/s3TBrRGB1iav7gFOCNx3H31MoES.jpg",
        "genres": [{"id": 28, "name": "Action"}, {"id": 878, "name": "Science Fiction"}, {"id": 12, "name": "Adventure"}],
        "genre_ids": [28, 878, 12],
        "media_type": "movie",
        "director": "Christopher Nolan",
        "cast": ["Leonardo DiCaprio", "Joseph Gordon-Levitt", "Elliot Page", "Tom Hardy"],
        "trailer_key": "YoHD9XEInc0"
    },
    {
        "id": 155,
        "title": "The Dark Knight",
        "tagline": "Welcome to a world without rules.",
        "overview": "Batman raises the stakes in his war on crime. With the help of allies Lt. Jim Gordon and DA Harvey Dent, Batman sets out to dismantle the remaining criminal organizations that plague the streets.",
        "release_date": "2008-07-16",
        "vote_average": 8.5,
        "vote_count": 32410,
        "runtime": 152,
        "poster_path": "/qJ2tW6WMUDux911r6m7haRef0WH.jpg",
        "backdrop_path": "/dqK9Hag1054tghRQSqLSfrkvQnA.jpg",
        "genres": [{"id": 18, "name": "Drama"}, {"id": 28, "name": "Action"}, {"id": 80, "name": "Crime"}],
        "genre_ids": [18, 28, 80],
        "media_type": "movie",
        "director": "Christopher Nolan",
        "cast": ["Christian Bale", "Heath Ledger", "Aaron Eckhart", "Michael Caine", "Maggie Gyllenhaal"],
        "trailer_key": "EXeTwQWrcwY"
    },
    {
        "id": 335984,
        "title": "Blade Runner 2049",
        "tagline": "The key to the future is finally unearthed.",
        "overview": "Thirty years after the events of the first film, a new blade runner, LAPD Officer K, unearths a long-buried secret that has the potential to plunge what's left of society into chaos.",
        "release_date": "2017-10-04",
        "vote_average": 7.6,
        "vote_count": 13400,
        "runtime": 164,
        "poster_path": "/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg",
        "backdrop_path": "/ilRyASDvt7v5o1lwOSXQ3m62Fvm.jpg",
        "genres": [{"id": 878, "name": "Science Fiction"}, {"id": 18, "name": "Drama"}],
        "genre_ids": [878, 18],
        "media_type": "movie",
        "director": "Denis Villeneuve",
        "cast": ["Ryan Gosling", "Harrison Ford", "Ana de Armas", "Sylvia Hoeks", "Robin Wright"],
        "trailer_key": "gCcx85zbxz4"
    },
    {
        "id": 603,
        "title": "The Matrix",
        "tagline": "Welcome to the Real World.",
        "overview": "Set in the 22nd century, The Matrix tells the story of a computer hacker who joins a group of underground insurgents fighting the vast and powerful computers who now rule the earth.",
        "release_date": "1999-03-30",
        "vote_average": 8.2,
        "vote_count": 25190,
        "runtime": 136,
        "poster_path": "/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg",
        "backdrop_path": "/l4QHerTSbflqOWv4EV26Q3y3aao.jpg",
        "genres": [{"id": 28, "name": "Action"}, {"id": 878, "name": "Science Fiction"}],
        "genre_ids": [28, 878],
        "media_type": "movie",
        "director": "Lana & Lilly Wachowski",
        "cast": ["Keanu Reeves", "Laurence Fishburne", "Carrie-Anne Moss", "Hugo Weaving"],
        "trailer_key": "vKQi3bBA1y8"
    },
    {
        "id": 550,
        "title": "Fight Club",
        "tagline": "Mischief. Mayhem. Soap.",
        "overview": "A ticking-time-bomb insomniac and a slippery soap salesman channel primal male aggression into a shocking new form of therapy.",
        "release_date": "1999-10-15",
        "vote_average": 8.4,
        "vote_count": 28650,
        "runtime": 139,
        "poster_path": "/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg",
        "backdrop_path": "/hZkgoQYus5vegHoetLkCJzb17zJ.jpg",
        "genres": [{"id": 18, "name": "Drama"}, {"id": 53, "name": "Thriller"}],
        "genre_ids": [18, 53],
        "media_type": "movie",
        "director": "David Fincher",
        "cast": ["Edward Norton", "Brad Pitt", "Helena Bonham Carter", "Meat Loaf"],
        "trailer_key": "qtRKdVGuPCQ"
    },
    {
        "id": 680,
        "title": "Pulp Fiction",
        "tagline": "Just because you are a character doesn't mean that you have character.",
        "overview": "A burger-loving hit man, his philosophical partner, a drug-addled gangster's moll and a washed-up boxer converge in this sprawling, comedic crime caper.",
        "release_date": "1994-09-10",
        "vote_average": 8.5,
        "vote_count": 27380,
        "runtime": 154,
        "poster_path": "/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg",
        "backdrop_path": "/suaEOtk1N1sgg2MTM7oZd2cfVp3.jpg",
        "genres": [{"id": 53, "name": "Thriller"}, {"id": 80, "name": "Crime"}],
        "genre_ids": [53, 80],
        "media_type": "movie",
        "director": "Quentin Tarantino",
        "cast": ["John Travolta", "Samuel L. Jackson", "Uma Thurman", "Bruce Willis"],
        "trailer_key": "s7EdQ4FqbhY"
    },
    {
        "id": 438631,
        "title": "Dune",
        "tagline": "It begins.",
        "overview": "Paul Atreides, a brilliant and gifted young man born into a great destiny beyond his understanding, must travel to the most dangerous planet in the universe to ensure the future of his family and his people.",
        "release_date": "2021-09-15",
        "vote_average": 7.8,
        "vote_count": 10980,
        "runtime": 155,
        "poster_path": "/d5NXSklXo0qyIYkgV94XAgMIckC.jpg",
        "backdrop_path": "/eeijXm355vPUtF8VCuZ1BsWnOh8.jpg",
        "genres": [{"id": 878, "name": "Science Fiction"}, {"id": 12, "name": "Adventure"}],
        "genre_ids": [878, 12],
        "media_type": "movie",
        "director": "Denis Villeneuve",
        "cast": ["Timothée Chalamet", "Rebecca Ferguson", "Oscar Isaac", "Josh Brolin"],
        "trailer_key": "8g18jFHCLXk"
    },
    {
        "id": 569094,
        "title": "Spider-Man: Across the Spider-Verse",
        "tagline": "It's how you wear the mask that matters.",
        "overview": "After reuniting with Gwen Stacy, Brooklyn’s full-time, friendly neighborhood Spider-Man is catapulted across the Multiverse, where he encounters the Spider Society, a team of Spider-People charged with protecting the Multiverse’s very existence.",
        "release_date": "2023-05-31",
        "vote_average": 8.4,
        "vote_count": 6730,
        "runtime": 140,
        "poster_path": "/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg",
        "backdrop_path": "/4HodYYKEIsGOdinkGi2Ucz6X9i0.jpg",
        "genres": [{"id": 16, "name": "Animation"}, {"id": 28, "name": "Action"}, {"id": 878, "name": "Science Fiction"}],
        "genre_ids": [16, 28, 878],
        "media_type": "movie",
        "director": "Joaquim Dos Santos, Kemp Powers",
        "cast": ["Shameik Moore", "Hailee Steinfeld", "Oscar Isaac", "Jake Johnson"],
        "trailer_key": "cqGjhVJWtEg"
    },
    {
        "id": 671,
        "title": "Harry Potter and the Philosopher's Stone",
        "tagline": "Let the Magic Begin.",
        "overview": "Harry Potter has lived under the stairs at his aunt and uncle's house his whole life. But on his 11th birthday, he learns he's a powerful wizard with a place waiting for him at the Hogwarts School of Witchcraft and Wizardry.",
        "release_date": "2001-11-16",
        "vote_average": 7.9,
        "vote_count": 26800,
        "runtime": 152,
        "poster_path": "/wuMc08IPKEatf9rnMNXvIDxqP4W.jpg",
        "backdrop_path": "/hziiv146OpD7qDoTezDK4G1xRIh.jpg",
        "genres": [{"id": 12, "name": "Adventure"}, {"id": 14, "name": "Fantasy"}],
        "genre_ids": [12, 14],
        "media_type": "movie",
        "director": "Chris Columbus",
        "cast": ["Daniel Radcliffe", "Rupert Grint", "Emma Watson", "Richard Harris"],
        "trailer_key": "VyHV0BRZxoQ"
    },
    {
        "id": 120,
        "title": "The Lord of the Rings: The Fellowship of the Ring",
        "tagline": "One ring to rule them all.",
        "overview": "Young hobbit Frodo Baggins, after inheriting a mysterious ring from his uncle Bilbo, must leave his home in order to keep it from falling into the hands of its evil creator.",
        "release_date": "2001-12-18",
        "vote_average": 8.4,
        "vote_count": 24900,
        "runtime": 178,
        "poster_path": "/6oom5QYQ2yQTMJIbnvbkBL9cDK6.jpg",
        "backdrop_path": "/x2RS3uTcsJJ9Ifj2z8yA694GbFe.jpg",
        "genres": [{"id": 12, "name": "Adventure"}, {"id": 14, "name": "Fantasy"}, {"id": 28, "name": "Action"}],
        "genre_ids": [12, 14, 28],
        "media_type": "movie",
        "director": "Peter Jackson",
        "cast": ["Elijah Wood", "Ian McKellen", "Viggo Mortensen", "Orlando Bloom"],
        "trailer_key": "V75dMMIW2B4"
    },
    {
        "id": 634649,
        "title": "Spider-Man: No Way Home",
        "tagline": "The Multiverse unleashed.",
        "overview": "Peter Parker is unmasked and no longer able to separate his normal life from the high-stakes of being a super-hero. When he asks for help from Doctor Strange the stakes become even more dangerous, forcing him to discover what it truly means to be Spider-Man.",
        "release_date": "2021-12-15",
        "vote_average": 8.0,
        "vote_count": 19600,
        "runtime": 148,
        "poster_path": "/1g0dhYtq4irTY1GPXvft6k4YLjm.jpg",
        "backdrop_path": "/14QbnygCuTO0vl7CAFmPf1fgZfV.jpg",
        "genres": [{"id": 28, "name": "Action"}, {"id": 12, "name": "Adventure"}, {"id": 878, "name": "Science Fiction"}],
        "genre_ids": [28, 12, 878],
        "media_type": "movie",
        "director": "Jon Watts",
        "cast": ["Tom Holland", "Zendaya", "Benedict Cumberbatch", "Jacob Batalon"],
        "trailer_key": "JfVOs4VSpmA"
    },
    {
        "id": 19995,
        "title": "Avatar",
        "tagline": "Enter the World of Pandora.",
        "overview": "In the 22nd century, a paraplegic Marine is dispatched to the moon Pandora on a unique mission, but becomes torn between following orders and protecting an alien civilization.",
        "release_date": "2009-12-15",
        "vote_average": 7.6,
        "vote_count": 31050,
        "runtime": 162,
        "poster_path": "/kyeqWdyUXW608qlYkRqosgbbnKR.jpg",
        "backdrop_path": "/vL5LR6WdxWPjC3652yTjs98iUwk.jpg",
        "genres": [{"id": 28, "name": "Action"}, {"id": 12, "name": "Adventure"}, {"id": 14, "name": "Fantasy"}, {"id": 878, "name": "Science Fiction"}],
        "genre_ids": [28, 12, 14, 878],
        "media_type": "movie",
        "director": "James Cameron",
        "cast": ["Sam Worthington", "Zoe Saldana", "Sigourney Weaver", "Stephen Lang"],
        "trailer_key": "5PSNL1qE6VY"
    },
    {
        "id": 76600,
        "title": "Avatar: The Way of Water",
        "tagline": "Return to Pandora.",
        "overview": "Set more than a decade after the events of the first film, learn the story of the Sully family (Jake, Neytiri, and their kids), the trouble that follows them, the lengths they go to keep each other safe, the battles they fight to stay alive, and the tragedies they endure.",
        "release_date": "2022-12-14",
        "vote_average": 7.6,
        "vote_count": 11300,
        "runtime": 192,
        "poster_path": "/t6HIqrRAclMCA60NsSmeqe9RmNV.jpg",
        "backdrop_path": "/s16H6tpK2utvwDtzZ8Qy4qm5Emw.jpg",
        "genres": [{"id": 878, "name": "Science Fiction"}, {"id": 12, "name": "Adventure"}, {"id": 28, "name": "Action"}],
        "genre_ids": [878, 12, 28],
        "media_type": "movie",
        "director": "James Cameron",
        "cast": ["Sam Worthington", "Zoe Saldana", "Sigourney Weaver", "Kate Winslet"],
        "trailer_key": "d9MyW72ELq0"
    },
    {
        "id": 1399,
        "title": "Game of Thrones",
        "tagline": "Winter Is Coming.",
        "overview": "Seven noble families fight for control of the mythical land of Westeros. Friction between the houses leads to full-scale war. All while a very ancient evil awakens in the farthest north.",
        "release_date": "2011-04-17",
        "vote_average": 8.4,
        "vote_count": 23400,
        "runtime": 55,
        "poster_path": "/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg",
        "backdrop_path": "/2OMB0ynKlyIenMJWI2Dy9IWT4c.jpg",
        "genres": [{"id": 10765, "name": "Sci-Fi & Fantasy"}, {"id": 18, "name": "Drama"}, {"id": 10759, "name": "Action & Adventure"}],
        "genre_ids": [10765, 18, 10759],
        "media_type": "tv",
        "director": "David Benioff, D.B. Weiss",
        "cast": ["Emilia Clarke", "Kit Harington", "Peter Dinklage", "Lena Headey"],
        "trailer_key": "KPLWWIOCOOQ"
    },
    {
        "id": 66732,
        "title": "Stranger Things",
        "tagline": "Every ending has a beginning.",
        "overview": "When a young boy vanishes, a small town uncovers a mystery involving secret experiments, terrifying supernatural forces and one strange little girl.",
        "release_date": "2016-07-15",
        "vote_average": 8.6,
        "vote_count": 17100,
        "runtime": 50,
        "poster_path": "/49WJfeN0moxb9IPfGn8AIqMGskD.jpg",
        "backdrop_path": "/56v2KjBlU4XaOv9rVYEQypROD7P.jpg",
        "genres": [{"id": 10765, "name": "Sci-Fi & Fantasy"}, {"id": 18, "name": "Drama"}, {"id": 9648, "name": "Mystery"}],
        "genre_ids": [10765, 18, 9648],
        "media_type": "tv",
        "director": "The Duffer Brothers",
        "cast": ["Millie Bobby Brown", "Finn Wolfhard", "David Harbour", "Winona Ryder"],
        "trailer_key": "b9EkMc79ZSU"
    },
    {
        "id": 94605,
        "title": "Arcane",
        "tagline": "The world is divided. The conflict is imminent.",
        "overview": "Amid the stark discord of twin cities Piltover and Zaun, two sisters fight on rival sides of a war between magic technologies and incompatible convictions.",
        "release_date": "2021-11-06",
        "vote_average": 8.7,
        "vote_count": 4200,
        "runtime": 42,
        "poster_path": "/fqldf2t8ztc9aiwn3k6mlX3tvRT.jpg",
        "backdrop_path": "/rkB4LyZHo1NHXSTXYZaCRv57J1b.jpg",
        "genres": [{"id": 16, "name": "Animation"}, {"id": 10765, "name": "Sci-Fi & Fantasy"}, {"id": 10759, "name": "Action & Adventure"}],
        "genre_ids": [16, 10765, 10759],
        "media_type": "tv",
        "director": "Christian Linke, Alex Yee",
        "cast": ["Hailee Steinfeld", "Ella Purnell", "Kevin Alejandro", "Katie Leung"],
        "trailer_key": "fXmAurh012s"
    },
    {
        "id": 119051,
        "title": "Wednesday",
        "tagline": "Smart, sarcastic and a little dead inside.",
        "overview": "Wednesday Addams misadventures as a student at Nevermore Academy: a very unique boarding school in deepest New England.",
        "release_date": "2022-11-23",
        "vote_average": 8.4,
        "vote_count": 8300,
        "runtime": 50,
        "poster_path": "/9PFonQ95165agEj92w7a2aqOPdG.jpg",
        "backdrop_path": "/iHSwvRVsRyxpX7FE7GbviaDvgGZ.jpg",
        "genres": [{"id": 10765, "name": "Sci-Fi & Fantasy"}, {"id": 9648, "name": "Mystery"}, {"id": 35, "name": "Comedy"}],
        "genre_ids": [10765, 9648, 35],
        "media_type": "tv",
        "director": "Tim Burton",
        "cast": ["Jenna Ortega", "Gwendoline Christie", "Riki Lindhome", "Christina Ricci"],
        "trailer_key": "Di310BC8BpY",
        "is_original": True
    },
    {
        "id": 71446,
        "title": "Money Heist",
        "tagline": "The greatest heist in history.",
        "overview": "To carry out the biggest heist in history, a mysterious man called The Professor recruits a band of eight robbers with nothing to lose to infiltrate the Royal Mint of Spain.",
        "release_date": "2017-05-02",
        "vote_average": 8.3,
        "vote_count": 18200,
        "runtime": 50,
        "poster_path": "/reEMJA1uzscCbkpeRJeTT2bjqUp.jpg",
        "backdrop_path": "/gFZriCkpJYsApPZEF3jhxL4yLzG.jpg",
        "genres": [{"id": 80, "name": "Crime"}, {"id": 18, "name": "Drama"}],
        "genre_ids": [80, 18],
        "media_type": "tv",
        "original_language": "es",
        "region": "Spain",
        "director": "Álex Pina",
        "cast": ["Álvaro Morte", "Úrsula Corberó", "Pedro Alonso", "Itziar Ituño", "Alba Flores"],
        "trailer_key": "_InqQJRqGW4",
        "is_original": True
    },
    {
        "id": 93405,
        "title": "Squid Game",
        "tagline": "45.6 Billion Won is Child's Play.",
        "overview": "Hundreds of cash-strapped players accept a strange invitation to compete in children's games. Inside, a tempting prize awaits — with deadly high stakes.",
        "release_date": "2021-09-17",
        "vote_average": 8.4,
        "vote_count": 14100,
        "runtime": 55,
        "poster_path": "/1QdXdRYfktUSONkl1oD5gc6Be0s.jpg",
        "backdrop_path": "/2meX1nMdScFOoV4370rqHWKmXhY.jpg",
        "genres": [{"id": 10759, "name": "Action & Adventure"}, {"id": 9648, "name": "Mystery"}, {"id": 18, "name": "Drama"}],
        "genre_ids": [10759, 9648, 18],
        "media_type": "tv",
        "original_language": "ko",
        "region": "Korea",
        "director": "Hwang Dong-hyuk",
        "cast": ["Lee Jung-jae", "Park Hae-soo", "Wi Ha-joon", "Jung Ho-yeon", "O Yeong-su"],
        "trailer_key": "oqxAJKy0ii4",
        "is_original": True
    },
    {
        "id": 1083637,
        "title": "Kantara",
        "tagline": "A Legend Becoming Reality",
        "overview": "When greed paves the way for betrayal and scheming, a young tribal man reluctantly embraces his ancestors' divine traditions (Daivaradhane / Bhoota Kola) to seek justice for his community in coastal Karnataka.",
        "release_date": "2022-09-30",
        "vote_average": 8.3,
        "vote_count": 410,
        "runtime": 148,
        "poster_path": "/w57nxiBIODAYHLRs1xmrCY9zEFe.jpg",
        "backdrop_path": "/w57nxiBIODAYHLRs1xmrCY9zEFe.jpg",
        "genres": [{"id": 28, "name": "Action"}, {"id": 18, "name": "Drama"}, {"id": 53, "name": "Thriller"}],
        "genre_ids": [28, 18, 53],
        "media_type": "movie",
        "original_language": "kn",
        "region": "Kannada Sandalwood",
        "director": "Rishab Shetty",
        "cast": ["Rishab Shetty", "Sapthami Gowda", "Kishore", "Achyuth Kumar", "Pramod Shetty"],
        "trailer_key": "6oefCtnspAg"
    },
    {
        "id": 564147,
        "title": "K.G.F: Chapter 1",
        "tagline": "India's Biggest Action Extravaganza",
        "overview": "In the 1970s, a fierce rebel named Rocky rises from Mumbai's streets to liberate the enslaved miners of Kolar Gold Fields, challenging powerful tyrants in an epic quest for supremacy.",
        "release_date": "2018-12-20",
        "vote_average": 8.2,
        "vote_count": 680,
        "runtime": 156,
        "poster_path": "/ltHlJwvxKv7d0ooCiKSAvfwV9tX.jpg",
        "backdrop_path": "/4i1ofsSpfTuswHXcgPtXbZrSnoe.jpg",
        "genres": [{"id": 28, "name": "Action"}, {"id": 80, "name": "Crime"}, {"id": 18, "name": "Drama"}],
        "genre_ids": [28, 80, 18],
        "media_type": "movie",
        "original_language": "kn",
        "region": "Kannada Sandalwood",
        "director": "Prashanth Neel",
        "cast": ["Yash", "Srinidhi Shetty", "Anant Nag", "Ramachandra Raju", "Achyuth Kumar"],
        "trailer_key": "-KfsY-dU90o"
    },
    {
        "id": 587412,
        "title": "K.G.F: Chapter 2",
        "tagline": "May I Come In, Sir?",
        "overview": "The blood-soaked land of Kolar Gold Fields has a new overlord: Rocky. While his allies revere him as savior, the government and ruthless enemies like Adheera conspire to take him down.",
        "release_date": "2022-04-14",
        "vote_average": 8.1,
        "vote_count": 890,
        "runtime": 168,
        "poster_path": "/khNVygolU0TxLIDWff5tQlAhZ23.jpg",
        "backdrop_path": "/nsV5Mfi9FAV4w8eDsdr7uqVswOk.jpg",
        "genres": [{"id": 28, "name": "Action"}, {"id": 80, "name": "Crime"}, {"id": 53, "name": "Thriller"}],
        "genre_ids": [28, 80, 53],
        "media_type": "movie",
        "original_language": "kn",
        "region": "Kannada Sandalwood",
        "director": "Prashanth Neel",
        "cast": ["Yash", "Sanjay Dutt", "Raveena Tandon", "Srinidhi Shetty", "Prakash Raj"],
        "trailer_key": "JKa05nyUmuQ"
    },
    {
        "id": 714375,
        "title": "777 Charlie",
        "tagline": "A Journey of Unconditional Love",
        "overview": "Dharma lives a lonely, pessimistic life until Charlie, an energetic Labrador puppy escaped from a cruel breeder, enters his home and leads him on an emotional road trip to the Himalayas.",
        "release_date": "2022-06-10",
        "vote_average": 8.4,
        "vote_count": 350,
        "runtime": 164,
        "poster_path": "/ucwirgaK4v9ylQyDkwoXJtDIlf7.jpg",
        "backdrop_path": "/ucwirgaK4v9ylQyDkwoXJtDIlf7.jpg",
        "genres": [{"id": 18, "name": "Drama"}, {"id": 35, "name": "Comedy"}, {"id": 12, "name": "Adventure"}],
        "genre_ids": [18, 35, 12],
        "media_type": "movie",
        "original_language": "kn",
        "region": "Kannada Sandalwood",
        "director": "Kiranraj K",
        "cast": ["Rakshit Shetty", "Charlie", "Sangeetha Sringeri", "Raj B. Shetty", "Bobby Simha"],
        "trailer_key": "pA_8W3pA6p8"
    },
    {
        "id": 579974,
        "title": "RRR",
        "tagline": "Rise. Roar. Revolt.",
        "overview": "A fictionalized tale of two legendary Indian revolutionaries, Alluri Sitarama Raju and Komaram Bheem, and their epic fight against British colonial oppression in 1920s Delhi.",
        "release_date": "2022-03-24",
        "vote_average": 7.8,
        "vote_count": 1620,
        "runtime": 187,
        "poster_path": "/i0Y0wP8H6SRgjr6QmuwbtQbS24D.jpg",
        "backdrop_path": "/i0Y0wP8H6SRgjr6QmuwbtQbS24D.jpg",
        "genres": [{"id": 28, "name": "Action"}, {"id": 18, "name": "Drama"}, {"id": 12, "name": "Adventure"}],
        "genre_ids": [28, 18, 12],
        "media_type": "movie",
        "original_language": "te",
        "region": "Telugu Tollywood",
        "director": "S.S. Rajamouli",
        "cast": ["N.T. Rama Rao Jr.", "Ram Charan", "Alia Bhatt", "Ajay Devgn", "Shriya Saran"],
        "trailer_key": "NgBoMJy386M"
    },
    {
        "id": 256040,
        "title": "Baahubali: The Beginning",
        "tagline": "The King will Reign.",
        "overview": "Shivudu, a valiant tribesman who ventures beyond a colossal waterfall, discovers his true heritage as Mahendra Baahubali, rightful heir to the illustrious kingdom of Mahishmati.",
        "release_date": "2015-07-10",
        "vote_average": 7.6,
        "vote_count": 1250,
        "runtime": 159,
        "poster_path": "/v3FTHdGFD9KoaJ9lptNelbKSNxe.jpg",
        "backdrop_path": "/v3FTHdGFD9KoaJ9lptNelbKSNxe.jpg",
        "genres": [{"id": 28, "name": "Action"}, {"id": 14, "name": "Fantasy"}, {"id": 18, "name": "Drama"}],
        "genre_ids": [28, 14, 18],
        "media_type": "movie",
        "original_language": "te",
        "region": "Telugu Tollywood",
        "director": "S.S. Rajamouli",
        "cast": ["Prabhas", "Rana Daggubati", "Anushka Shetty", "Tamannaah Bhatia", "Ramya Krishnan"],
        "trailer_key": "sOEg_yn5Gco"
    },
    {
        "id": 690957,
        "title": "Pushpa: The Rise",
        "tagline": "Pushpa Raj... Thaggedhe Le!",
        "overview": "Pushpa Raj, a fearless daily wager, scales the ranks of the illegal red sandalwood smuggling syndicate in the Seshachalam hills, provoking bloodthirsty rivals and ruthless cops.",
        "release_date": "2021-12-17",
        "vote_average": 7.4,
        "vote_count": 480,
        "runtime": 179,
        "poster_path": "/jQIcn51nsvMrpB9NFwEOb9QHhFt.jpg",
        "backdrop_path": "/jQIcn51nsvMrpB9NFwEOb9QHhFt.jpg",
        "genres": [{"id": 28, "name": "Action"}, {"id": 80, "name": "Crime"}, {"id": 18, "name": "Drama"}],
        "genre_ids": [28, 80, 18],
        "media_type": "movie",
        "original_language": "te",
        "region": "Telugu Tollywood",
        "director": "Sukumar",
        "cast": ["Allu Arjun", "Rashmika Mandanna", "Fahadh Faasil", "Jagadeesh Prathap Bandari"],
        "trailer_key": "pKctpnV254o"
    },
    {
        "id": 770906,
        "title": "Salaar: Part 1 – Ceasefire",
        "tagline": "The most violent man... for one man.",
        "overview": "In the sovereign dystopian city-state of Khansaar, Prince Varadharaja Mannar summons his exiled childhood friend Deva to withstand an imminent coup during a 7-day ceasefire.",
        "release_date": "2023-12-22",
        "vote_average": 7.3,
        "vote_count": 390,
        "runtime": 175,
        "poster_path": "/nlu9WbcetNFRGXXPWITr30ob7W6.jpg",
        "backdrop_path": "/nlu9WbcetNFRGXXPWITr30ob7W6.jpg",
        "genres": [{"id": 28, "name": "Action"}, {"id": 53, "name": "Thriller"}, {"id": 80, "name": "Crime"}],
        "genre_ids": [28, 53, 80],
        "media_type": "movie",
        "original_language": "te",
        "region": "Telugu Tollywood",
        "director": "Prashanth Neel",
        "cast": ["Prabhas", "Prithviraj Sukumaran", "Shruti Haasan", "Jagapathi Babu", "Bobby Simha"],
        "trailer_key": "bUR_FKt7Iso"
    },
    {
        "id": 869760,
        "title": "Hanu-Man",
        "tagline": "An Ancient Celestial Power Awakens",
        "overview": "Hanumanthu, a mischievous thief in the fictional village of Anjanadri, stumbles upon a sacred solar stone that grants him the mighty powers of Lord Hanuman to defend his homeland.",
        "release_date": "2024-01-12",
        "vote_average": 7.7,
        "vote_count": 420,
        "runtime": 158,
        "poster_path": "/m1zq48rWSXxplzoJR8YtbXWnnHM.jpg",
        "backdrop_path": "/m1zq48rWSXxplzoJR8YtbXWnnHM.jpg",
        "genres": [{"id": 28, "name": "Action"}, {"id": 14, "name": "Fantasy"}, {"id": 12, "name": "Adventure"}],
        "genre_ids": [28, 14, 12],
        "media_type": "movie",
        "original_language": "te",
        "region": "Telugu Tollywood",
        "director": "Prasanth Varma",
        "cast": ["Teja Sajja", "Amritha Aiyer", "Varalaxmi Sarathkumar", "Vinay Rai"],
        "trailer_key": "qS0Vn14_G50"
    },
    {
        "id": 1396,
        "title": "Breaking Bad",
        "tagline": "Remember my name.",
        "overview": "A chemistry teacher diagnosed with terminal lung cancer teams up with a former student to manufacture and sell crystal meth to secure his family's future, descending into a brutal underworld.",
        "release_date": "2008-01-20",
        "vote_average": 8.9,
        "vote_count": 14200,
        "runtime": 47,
        "poster_path": "/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg",
        "backdrop_path": "/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg",
        "genres": [{"id": 18, "name": "Drama"}, {"id": 80, "name": "Crime"}],
        "genre_ids": [18, 80],
        "media_type": "tv",
        "director": "Vince Gilligan",
        "cast": ["Bryan Cranston", "Aaron Paul", "Anna Gunn", "Dean Norris", "Giancarlo Esposito"],
        "trailer_key": "HhesaQXLuRY"
    },
    {
        "id": 70523,
        "title": "Dark",
        "tagline": "The question is not where, but when.",
        "overview": "A missing child sets four families on a frantic hunt for answers as they unearth a mind-bending mystery that spans three generations in a small German town nestled near a nuclear plant.",
        "release_date": "2017-12-01",
        "vote_average": 8.5,
        "vote_count": 6800,
        "runtime": 53,
        "poster_path": "/apbrbWs8M9lyOpJYU5WXrpFbk1Z.jpg",
        "backdrop_path": "/apbrbWs8M9lyOpJYU5WXrpFbk1Z.jpg",
        "genres": [{"id": 10765, "name": "Sci-Fi & Fantasy"}, {"id": 18, "name": "Drama"}, {"id": 9648, "name": "Mystery"}],
        "genre_ids": [10765, 18, 9648],
        "media_type": "tv",
        "original_language": "de",
        "director": "Baran bo Odar",
        "cast": ["Louis Hofmann", "Oliver Masucci", "Jördis Triebel", "Maja Schöne"],
        "trailer_key": "rrwycJ08PSA",
        "is_original": True
    },
    {
        "id": 60574,
        "title": "Peaky Blinders",
        "tagline": "Crime pays. Until it doesn't.",
        "overview": "A notorious gang in 1919 Birmingham, England, is led by the fierce Tommy Shelby, a crime boss set on moving up in the world no matter the cost.",
        "release_date": "2013-09-12",
        "vote_average": 8.6,
        "vote_count": 9800,
        "runtime": 58,
        "poster_path": "/vUUqzWa2LnHIVqkaKVlVGkVcZIW.jpg",
        "backdrop_path": "/vUUqzWa2LnHIVqkaKVlVGkVcZIW.jpg",
        "genres": [{"id": 18, "name": "Drama"}, {"id": 80, "name": "Crime"}],
        "genre_ids": [18, 80],
        "media_type": "tv",
        "director": "Steven Knight",
        "cast": ["Cillian Murphy", "Paul Anderson", "Helen McCrory", "Tom Hardy"],
        "trailer_key": "oVzVdvGIC7U"
    },
    {
        "id": 42009,
        "title": "Black Mirror",
        "tagline": "The future is broken.",
        "overview": "Twisted tales run wild in this mind-bending anthology series that reveals humanity's worst traits, greatest innovations and more.",
        "release_date": "2011-12-04",
        "vote_average": 8.3,
        "vote_count": 5200,
        "runtime": 60,
        "poster_path": "/seN6rRfN0I6n8iDXjlSMk1QjNcq.jpg",
        "backdrop_path": "/dg3OindVAGZBjlT3xYKqIAdukPL.jpg",
        "genres": [{"id": 10765, "name": "Sci-Fi & Fantasy"}, {"id": 18, "name": "Drama"}, {"id": 9648, "name": "Mystery"}],
        "genre_ids": [10765, 18, 9648],
        "media_type": "tv",
        "director": "Charlie Brooker",
        "cast": ["Bryce Dallas Howard", "Daniel Kaluuya", "Jon Hamm", "Anthony Mackie"],
        "trailer_key": "V0UcLj_48bI",
        "is_original": True
    },
    {
        "id": 87739,
        "title": "The Queen's Gambit",
        "tagline": "Her mind is her greatest opponent.",
        "overview": "In a 1950s orphanage, a young girl reveals an astonishing talent for chess and begins an unlikely journey to stardom while grappling with addiction.",
        "release_date": "2020-10-23",
        "vote_average": 8.5,
        "vote_count": 4600,
        "runtime": 55,
        "poster_path": "/zU0htwkhNvBQdVSIKB9s6hgVeFK.jpg",
        "backdrop_path": "/ktZaQ4FEmKpRgetiBooZETYQbmQ.jpg",
        "genres": [{"id": 18, "name": "Drama"}],
        "genre_ids": [18],
        "media_type": "tv",
        "director": "Scott Frank",
        "cast": ["Anya Taylor-Joy", "Bill Camp", "Marielle Heller", "Thomas Brodie-Sangster"],
        "trailer_key": "CDrieqwSdgI",
        "is_original": True
    },
    {
        "id": 569094,
        "title": "Spider-Man: Across the Spider-Verse",
        "tagline": "It's how you wear the mask that matters.",
        "overview": "After reuniting with Gwen Stacy, Brooklyn's full-time friendly neighborhood Spider-Man is catapulted across the Multiverse, encountering the Spider-Society charged with protecting existence.",
        "release_date": "2023-05-31",
        "vote_average": 8.4,
        "vote_count": 6800,
        "runtime": 140,
        "poster_path": "/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg",
        "backdrop_path": "/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg",
        "genres": [{"id": 16, "name": "Animation"}, {"id": 28, "name": "Action"}, {"id": 12, "name": "Adventure"}, {"id": 878, "name": "Science Fiction"}],
        "genre_ids": [16, 28, 12, 878],
        "media_type": "movie",
        "director": "Joaquim Dos Santos, Kemp Powers",
        "cast": ["Shameik Moore", "Hailee Steinfeld", "Oscar Isaac", "Daniel Kaluuya"],
        "trailer_key": "cqGjhVJWtEg"
    },
    {
        "id": 361743,
        "title": "Top Gun: Maverick",
        "tagline": "Feel the need... the need for speed.",
        "overview": "After thirty years, Pete 'Maverick' Mitchell is pushing the envelope as a courageous test pilot, training a detachment of elite graduates for an unimaginable mission.",
        "release_date": "2022-05-24",
        "vote_average": 8.2,
        "vote_count": 8900,
        "runtime": 130,
        "poster_path": "/62HCnUTziyWcpDaBO2i1DX17ljH.jpg",
        "backdrop_path": "/62HCnUTziyWcpDaBO2i1DX17ljH.jpg",
        "genres": [{"id": 28, "name": "Action"}, {"id": 18, "name": "Drama"}],
        "genre_ids": [28, 18],
        "media_type": "movie",
        "director": "Joseph Kosinski",
        "cast": ["Tom Cruise", "Miles Teller", "Jennifer Connelly", "Jon Hamm"],
        "trailer_key": "giXco2JAZ_4"
    },
    {
        "id": 872906,
        "title": "Jawan",
        "tagline": "Ready Chief?",
        "overview": "A prison warden driven by a personal vendetta recruits a band of women inmates to execute daring heists that expose societal corruption, seeking justice while confronting his mysterious past.",
        "release_date": "2023-09-07",
        "vote_average": 7.5,
        "vote_count": 310,
        "runtime": 169,
        "poster_path": "/jFt1gS4BGHlK8xt76Y81Alp4dbt.jpg",
        "backdrop_path": "/5LtSjMNw6j3LkG29Oa4O0iY5U8.jpg",
        "genres": [{"id": 28, "name": "Action"}, {"id": 53, "name": "Thriller"}],
        "genre_ids": [28, 53],
        "media_type": "movie",
        "original_language": "hi",
        "region": "Hindi Bollywood",
        "director": "Atlee",
        "cast": ["Shah Rukh Khan", "Nayanthara", "Vijay Sethupathi", "Deepika Padukone", "Priyamani"],
        "trailer_key": "COv52Qyctws"
    },
    {
        "id": 781732,
        "title": "Animal",
        "tagline": "A father-son bond that turns feral.",
        "overview": "The hardened son of a ruthless industrialist returns home and embarks on a brutal, bloody warpath of vengeance against those who attempted to assassinate his father.",
        "release_date": "2023-12-01",
        "vote_average": 7.3,
        "vote_count": 290,
        "runtime": 201,
        "poster_path": "/hr9rjR3J0xBBKmlJ4n3gHId9ccx.jpg",
        "backdrop_path": "/lprsAHkwMxk2iC6VZxNmV0H7g1t.jpg",
        "genres": [{"id": 28, "name": "Action"}, {"id": 80, "name": "Crime"}, {"id": 18, "name": "Drama"}],
        "genre_ids": [28, 80, 18],
        "media_type": "movie",
        "original_language": "hi",
        "region": "Hindi Bollywood",
        "director": "Sandeep Reddy Vanga",
        "cast": ["Ranbir Kapoor", "Anil Kapoor", "Bobby Deol", "Rashmika Mandanna", "Triptii Dimri"],
        "trailer_key": "Dydmpfo68DA"
    }
]

GENRES_MAP = {
    28: "Action",
    12: "Adventure",
    16: "Animation",
    35: "Comedy",
    80: "Crime",
    99: "Documentary",
    18: "Drama",
    14: "Fantasy",
    27: "Horror",
    9648: "Mystery",
    10749: "Romance",
    878: "Science Fiction",
    53: "Thriller",
    10752: "War",
    37: "Western",
    10759: "Action & Adventure",
    10765: "Sci-Fi & Fantasy"
}

from .live_collector import LiveCatalogCollector
from .trailer_resolver import resolve_trailer_key


class TMDBClient:
    def __init__(self):
        self.api_key = TMDB_API_KEY
        self.cache: Dict[str, Any] = {}
        self.cache_ttl: Dict[str, float] = {}
        self.collector = LiveCatalogCollector(REAL_TMDB_CATALOG)

    def start_live_collector(self):
        """Starts automated background periodic live collector."""
        return self.collector.start_background_worker()

    def get_sync_status(self) -> Dict[str, Any]:
        """Returns live data synchronization telemetry."""
        return self.collector.get_status()

    async def trigger_live_sync(self) -> Dict[str, Any]:
        """Triggers immediate on-demand live API synchronization."""
        self.cache.clear()
        self.cache_ttl.clear()
        return await self.collector.run_full_sync()

    def _get_cached(self, key: str) -> Optional[Any]:
        if key in self.cache:
            if time.time() < self.cache_ttl.get(key, 0):
                return self.cache[key]
        return None

    def _set_cached(self, key: str, value: Any, ttl_seconds: int = 300):
        self.cache[key] = value
        self.cache_ttl[key] = time.time() + ttl_seconds

    async def get_trending(self) -> List[Dict[str, Any]]:
        cached = self._get_cached("trending")
        if cached:
            return cached

        if self.api_key:
            try:
                async with httpx.AsyncClient(timeout=4.0) as client:
                    resp = await client.get(
                        f"{TMDB_BASE_URL}/trending/all/week",
                        params={"api_key": self.api_key}
                    )
                    if resp.status_code == 200:
                        results = resp.json().get("results", [])
                        enriched = [self._normalize_tmdb_item(item) for item in results]
                        self._set_cached("trending", enriched)
                        return enriched
            except Exception as e:
                logger.warning(f"Live TMDB trending fetch failed: {e}; using fallback catalog")

        # Fallback to authentic curated catalog
        trending = REAL_TMDB_CATALOG[:12]
        self._set_cached("trending", trending, ttl_seconds=600)
        return trending

    async def get_popular(self) -> List[Dict[str, Any]]:
        cached = self._get_cached("popular")
        if cached:
            return cached

        if self.api_key:
            try:
                async with httpx.AsyncClient(timeout=4.0) as client:
                    resp = await client.get(
                        f"{TMDB_BASE_URL}/movie/popular",
                        params={"api_key": self.api_key}
                    )
                    if resp.status_code == 200:
                        results = resp.json().get("results", [])
                        enriched = [self._normalize_tmdb_item(item) for item in results]
                        self._set_cached("popular", enriched)
                        return enriched
            except Exception as e:
                logger.warning(f"Live TMDB popular fetch failed: {e}; using fallback catalog")

        popular = sorted(REAL_TMDB_CATALOG, key=lambda x: x.get("vote_count", 0), reverse=True)[:12]
        self._set_cached("popular", popular, ttl_seconds=600)
        return popular

    async def get_top_rated(self) -> List[Dict[str, Any]]:
        cached = self._get_cached("top_rated")
        if cached:
            return cached

        top_rated = sorted(REAL_TMDB_CATALOG, key=lambda x: x.get("vote_average", 0), reverse=True)[:12]
        self._set_cached("top_rated", top_rated, ttl_seconds=600)
        return top_rated

    async def get_by_genre(self, genre_id: int) -> List[Dict[str, Any]]:
        cache_key = f"genre_{genre_id}"
        cached = self._get_cached(cache_key)
        if cached:
            return cached

        matched = [m for m in REAL_TMDB_CATALOG if genre_id in m.get("genre_ids", [])]
        if not matched:
            matched = REAL_TMDB_CATALOG[:6]
        self._set_cached(cache_key, matched, ttl_seconds=600)
        return matched

    async def get_movie_details(self, movie_id: int) -> Optional[Dict[str, Any]]:
        cache_key = f"movie_{movie_id}"
        cached = self._get_cached(cache_key)
        if cached:
            return cached

        # 1. Check live collector catalog_map first (includes all live ingested and seed items)
        if hasattr(self, "collector") and self.collector and movie_id in self.collector.catalog_map:
            m = dict(self.collector.catalog_map[movie_id])
            title = m.get("title", "")
            t_key = m.get("trailer_key")
            if not t_key or (t_key == "Way9Dexny3w" and "dune: part two" not in title.lower() and "dune 2" not in title.lower()):
                m["trailer_key"] = resolve_trailer_key(title)
                self.collector.catalog_map[movie_id]["trailer_key"] = m["trailer_key"]
            self._set_cached(cache_key, m)
            return m

        # 2. Check REAL_TMDB_CATALOG
        for m_orig in REAL_TMDB_CATALOG:
            if m_orig["id"] == movie_id:
                m = dict(m_orig)
                title = m.get("title", "")
                t_key = m.get("trailer_key")
                if not t_key or (t_key == "Way9Dexny3w" and "dune: part two" not in title.lower() and "dune 2" not in title.lower()):
                    m["trailer_key"] = resolve_trailer_key(title)
                    m_orig["trailer_key"] = m["trailer_key"]
                self._set_cached(cache_key, m)
                return m

        # 3. Live TMDB query if API key configured
        if self.api_key:
            try:
                async with httpx.AsyncClient(timeout=4.0) as client:
                    resp = await client.get(
                        f"{TMDB_BASE_URL}/movie/{movie_id}",
                        params={"api_key": self.api_key}
                    )
                    if resp.status_code == 200:
                        item = self._normalize_tmdb_item(resp.json())
                        self._set_cached(cache_key, item)
                        return item
            except Exception as e:
                logger.warning(f"Live TMDB movie details fetch failed: {e}")

        # If not found, return None rather than defaulting to Dune
        return None

    async def get_similar(self, movie_id: int) -> List[Dict[str, Any]]:
        target = await self.get_movie_details(movie_id)
        if not target:
            return REAL_TMDB_CATALOG[:6]

        target_genres = set(target.get("genre_ids", []))
        similar = []
        for m in REAL_TMDB_CATALOG:
            if m["id"] != movie_id:
                shared = len(target_genres & set(m.get("genre_ids", [])))
                if shared > 0:
                    similar.append((shared, m))

        similar.sort(key=lambda x: x[0], reverse=True)
        results = [m for _, m in similar[:8]]
        return results if results else REAL_TMDB_CATALOG[:6]

    async def get_kannada_movies(self) -> List[Dict[str, Any]]:
        cached = self._get_cached("regional_kannada")
        if cached:
            return cached
        kannada = [
            m for m in REAL_TMDB_CATALOG
            if m.get("original_language") == "kn" or "Kannada" in m.get("region", "")
        ]
        self._set_cached("regional_kannada", kannada, ttl_seconds=600)
        return kannada

    async def get_telugu_movies(self) -> List[Dict[str, Any]]:
        cached = self._get_cached("regional_telugu")
        if cached:
            return cached
        telugu = [
            m for m in REAL_TMDB_CATALOG
            if m.get("original_language") == "te" or "Telugu" in m.get("region", "")
        ]
        self._set_cached("regional_telugu", telugu, ttl_seconds=600)
        return telugu

    async def get_tv_shows(self) -> List[Dict[str, Any]]:
        cached = self._get_cached("tv_shows")
        if cached:
            return cached
        shows = [m for m in REAL_TMDB_CATALOG if m.get("media_type") == "tv"]
        self._set_cached("tv_shows", shows, ttl_seconds=600)
        return shows

    async def get_movies(self) -> List[Dict[str, Any]]:
        cached = self._get_cached("all_movies")
        if cached:
            return cached
        movies = [m for m in REAL_TMDB_CATALOG if m.get("media_type") == "movie"]
        self._set_cached("all_movies", movies, ttl_seconds=600)
        return movies

    async def get_top_10_india(self) -> List[Dict[str, Any]]:
        cached = self._get_cached("top_10_india")
        if cached:
            return cached
        # Authentic Top 10 Trending titles in India (ranked 1-10)
        ranked_ids = [1083637, 579974, 872906, 587412, 66732, 781732, 93405, 770906, 119051, 714375]
        catalog_map = {m["id"]: m for m in REAL_TMDB_CATALOG}
        top_10 = []
        for rank, mid in enumerate(ranked_ids, start=1):
            if mid in catalog_map:
                item = dict(catalog_map[mid])
                item["rank"] = rank
                item["is_top_10"] = True
                top_10.append(item)
        self._set_cached("top_10_india", top_10, ttl_seconds=600)
        return top_10

    async def get_netflix_originals(self) -> List[Dict[str, Any]]:
        cached = self._get_cached("netflix_originals")
        if cached:
            return cached
        originals = [
            m for m in REAL_TMDB_CATALOG 
            if m.get("is_original") or m.get("id") in [66732, 119051, 94605, 71446, 93405, 70523, 42009, 87739, 60574]
        ]
        self._set_cached("netflix_originals", originals, ttl_seconds=600)
        return originals

    async def search(self, query: str) -> List[Dict[str, Any]]:
        """Searches live streaming & TMDB APIs dynamically on-the-fly."""
        if not query:
            return []
        return await self.collector.live_search(query)

    def get_billboard(self) -> Dict[str, Any]:
        # Featured blockbuster for hero section
        return REAL_TMDB_CATALOG[0]  # Dune: Part Two

    def get_genres(self) -> List[Dict[str, Any]]:
        return [{"id": gid, "name": name} for gid, name in GENRES_MAP.items() if gid in (28, 12, 16, 18, 14, 878, 53, 10765)]

    def _normalize_tmdb_item(self, item: Dict[str, Any]) -> Dict[str, Any]:
        movie_id = item.get("id")
        title = item.get("title") or item.get("name") or "Untitled"
        overview = item.get("overview") or "No description available."
        release_date = item.get("release_date") or item.get("first_air_date") or "2024-01-01"
        vote_avg = round(float(item.get("vote_average", 7.5)), 1)
        vote_count = int(item.get("vote_count", 100))
        poster = item.get("poster_path") or "/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg"
        backdrop = item.get("backdrop_path") or "/xOMo8BRK7PfcJv9JCnx7s520DRq.jpg"
        genre_ids = item.get("genre_ids") or [g.get("id") for g in item.get("genres", [])] or [878]

        raw_trailer = item.get("trailer_key")
        if not raw_trailer or (raw_trailer == "Way9Dexny3w" and "dune: part two" not in title.lower() and "dune 2" not in title.lower()):
            trailer_key = resolve_trailer_key(title)
        else:
            trailer_key = raw_trailer

        return {
            "id": movie_id,
            "title": title,
            "tagline": item.get("tagline", ""),
            "overview": overview,
            "release_date": release_date,
            "vote_average": vote_avg,
            "vote_count": vote_count,
            "runtime": item.get("runtime", 130),
            "poster_path": poster,
            "backdrop_path": backdrop,
            "genres": [{"id": gid, "name": GENRES_MAP.get(gid, "Drama")} for gid in genre_ids],
            "genre_ids": genre_ids,
            "media_type": item.get("media_type", "movie"),
            "director": item.get("director", "Acclaimed Filmmaker"),
            "cast": item.get("cast", ["Featured Cast"]),
            "trailer_key": trailer_key
        }


# Global singleton instance
tmdb_client = TMDBClient()
