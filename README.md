<h1 align="center">Wikipedia Map</h1>
<p align="center">A web app for visualizing the connections between Wikipedia pages, powered by AI.</p>

![Screenshot of Wikipedia Map](screenshots/wikipedia-map-safari.png)


## Usage
Start by entering a topic into the text box, for example *Cats*. A single “node” will be generated, labeled *Cat*, which appears as a circle on the graph. Click this node to expand it.

Expanding a node creates a **new node for each Wikipedia article linked in the first paragraph of the article you clicked**. These new nodes will be connected to the node from which they were expanded. For example, expanding *Cat* will create eight nodes, including *Fur*, *Mammal*, *Carnivore*, and *Domestication*, each of which will be connected to *Cat*. These new nodes can also be expanded in the same way. By continuing to expand nodes, you can build a complex web of related topics.

You can also enter multiple articles to "compare" by pressing Comma, Tab, or Enter after each one you enter.


## How it works

#### API
When you click to expand a node, a request is made to the Wikipedia API to download the full content of the Wikipedia article corresponding to that node. Wikipedia map uses this data to find the links in the first paragraph of the article.

#### HTML Parsing
`wikipedia_parse_v10.js` uses the [`DOMParser` API](https://developer.mozilla.org/en-US/docs/Web/API/DOMParser) to parse wikipedia pages’ HTML (retrieved from calls to Wikipedia's API). The parser looks for the `<p>` tag corresponding to the first paragraph of the article, then extracts all of the `<a>` tag links within this paragraph. It then filters the links to include only those which link to other wikipedia articles.

You can see this in action yourself in your browser’s console. If you have Wikipedia Map open, open your browser’s developer tools and type `await getSubPages('Cat')`. After a second, you should see an array with the names of other related articles.

#### The graph
The front-end uses [`vis.js`](https://visjs.org/) to display the graph. The resulting links are added as new nodes, colored according to their distance from the central node (as described above).

#### AI Agent & Backend Server
The app now includes a Node.js server to power AI features for synthesizing the connections and generating "Interesting Connections". The AI backend runs with an Express.js server in `server.js`, connecting to an Ollama instance to analyze the graph structure and Tavily to conduct targeted research.


## Running Locally
To use the app locally, clone this repository and install the dependencies for the server:

```bash
git clone https://github.com/your-username/wikipedia-map.git
cd wikipedia-map
npm install
```

### Environment Variables
For the AI backend to work, you must set up your environment variables.
Create a `.env` file in the project root:

```env
PORT=8000
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gemini-3-flash-preview
TAVILY_API_KEY=your_tavily_api_key_here
```

### Start the Server
Start the server to serve both the frontend and the AI endpoints:

```bash
npm start
```

Then, open `http://localhost:8000` (or whichever port you configured) in your web browser.


## Design choices

#### Functional
Expanding a node creates nodes for each article linked in the _first paragraph_ of the article for the node you expand. I've chosen to use links only from the first paragraph of an article for 2 reasons:

1. There is usually a manageable number of these links, about 5-10 per page.
2. These links tend to be more directly relevant to the article than links further down in the page.

#### Visual
Nodes are lighter in color when they are farther away from the central node. If it took 5 steps to reach *Ancient Greek* from *Penguin*, it will be a lighter color than a node like *Birding*, which only took 2 steps to reach. Thus, a node's color indicates how closely an article is related to the central topic.

Hovering the mouse over a node will highlight the path back to the central node:
![Traceback](screenshots/traceback.png)
This is not necessarily the shortest path back; it is the path that you took to reach the node.


## Credits
This project is powered by Wikipedia, whose wealth of information makes this project possible.

The presentation of the graph is powered by [`vis.js`](https://visjs.org).
