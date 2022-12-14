import { readdir, writeFile } from 'fs/promises';

const TOKEN = 'LUL';
const USER_ID = 'LUL';

const BASE_TIDAL_URL = 'https://api.tidal.com';

// urls are probably subject to change as i've collected them by simple manual scraping
const URLS = {
  // you may changed useless params such as countryCode etc, but the request is rejected without them
  tidalSearchAPIURL: (trackName: string) => `${BASE_TIDAL_URL}/v1/search/top-hits?query=${trackName}&limit=3&offset=0&types=ARTISTS,ALBUMS,TRACKS,VIDEOS,PLAYLISTS&includeContributors=true&countryCode=IL&locale=en_US&deviceType=BROWSER`,
  // used to filter out tracks that are already in your collection
  // note the 5000 limit - its not validated server side, so you're free to set whatever you want
  collectionAPIURL: () => `https://listen.tidal.com/v1/users/${USER_ID}/favorites/tracks?offset=0&limit=5000&order=DATE&orderDirection=DESC&countryCode=IL&locale=en_US&deviceType=BROWSER`,
  generateTrackURLFromID: (id: number) => `${BASE_TIDAL_URL}/track/${id}`,
  addToCollection: () => `${BASE_TIDAL_URL}/v1/users/${USER_ID}/favorites/tracks?countryCode=IL&locale=en_US&deviceType=BROWSER`,
};

const failedIDRequests: string[] = [];

// THIS IS WINDOWS FORMATING - change to unix if not on windows
const TARGET_FOLDER_PATH = `C:\\Users\\admag\\Desktop\\Music`

const removeFileExtensions = (list: string[]) => list.map(item => item.replace(/\.(mp3|MP3|wma|flac|wav)/, ''));

async function getTrackList() {  
  const list = await readdir(TARGET_FOLDER_PATH);
  
  return removeFileExtensions(list);
}

function headersWithToken() {
  return {
    'Authorization': TOKEN,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

async function getTrackIds(trackList: string[]) {  
  return Promise.allSettled(trackList.map(async (track) => {
    try {
      const response = await fetch(URLS.tidalSearchAPIURL(track), {
        headers: headersWithToken(),
      });
      const data = await response.json();

      // if (!track.toLowerCase().includes(data.tracks.items[0].title.toLowerCase())) {
      //   throw new Error(`Looked for ${track} but found ${data.tracks.items[0].title} which is not contained in the full track name, track hasn't been added`);
      // }

      // optimistic approach - the first result is probably the correct track
      return data.tracks.items[0].id;
    } catch (e) {
      console.log(`${track} - ${e}`);
      failedIDRequests.push(track);
    }
  }));
}

function getSuccessfulIDResults(results: PromiseSettledResult<any>[]) {
  return results.reduce((successfulResults: any[], result: PromiseSettledResult<any>) => {
    if (result.status === 'fulfilled') {
      successfulResults.push(result.value);
    }

    return successfulResults;
  }, []);
}

async function getTracksInCollection() {
  const response = await fetch(URLS.collectionAPIURL(), {
    headers: headersWithToken(),
  });
  const data = await response.json();

  const trackIdsInCollection = data.items.map((track: any) => track.item.id);
  
  return new Set(trackIdsInCollection);
}

async function addToCollection(trackIds: number[]) {
  return Promise.allSettled(trackIds.map(async (trackId) => {
    try {
      await fetch(URLS.addToCollection(), {
        method: 'POST',
        // wtf is wrong with you tidal backend devs?
        body: `trackIds=${trackId}&onArtifactNotFound=FAIL`,
        headers: headersWithToken(),
      });
      // api responds with an empty 200
      console.log(`added ${trackId} to collection`);

    } catch (e) {
      console.log(e);
      
      return `${trackId} NOT ADDED!`;
    }
  }));
}

(async () => {
  const trackList = await getTrackList();
  const trackIDs = await getTrackIds(trackList);
  const tracksInCollectionSet = await getTracksInCollection();
  console.log(`Got ${trackIDs.length} track ID responses`);
  
  const failedTrackIDRequests = trackIDs.filter(item => item.status === 'rejected');
  console.log(`Failed to get ID for ${failedTrackIDRequests.length} tracks`);
  await writeFile('./failed-additions', JSON.stringify(failedTrackIDRequests), 'utf8');

  const successfulTrackIDRequests = getSuccessfulIDResults(trackIDs);
  console.log(`Found ${successfulTrackIDRequests.length} tracks`);

  console.log(`Filtering out ${tracksInCollectionSet.size} tracks that are already in collection`);
  const filteredIDs = successfulTrackIDRequests.filter(item => !tracksInCollectionSet.has(item));
  console.log(`Found ${filteredIDs.length} tracks that are not in collection`);
  
  await addToCollection(filteredIDs);

  console.log(`Failed to get IDs for ${failedIDRequests.length} tracks, see ./failedIDRequests for the name list`);
  await writeFile('./failedIDRequests.json', JSON.stringify(failedIDRequests), 'utf-8');
})();
