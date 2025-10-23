"""
Automated Guideline Discovery Service
Scrapes RCOG and NICE websites to find missing guidelines
"""

import requests
from bs4 import BeautifulSoup
import json
import logging
from typing import List, Dict, Set
from pathlib import Path
import re
from datetime import datetime

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class GuidelineDiscoveryService:
    def __init__(self):
        self.rcog_base_url = "https://www.rcog.org.uk"
        self.nice_base_url = "https://www.nice.org.uk"
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        
    def get_current_guidelines(self) -> Set[str]:
        """Load current guidelines from list_of_guidelines.txt"""
        guidelines_file = Path('guidance/list_of_guidelines.txt')
        if not guidelines_file.exists():
            logging.warning("list_of_guidelines.txt not found")
            return set()
        
        with open(guidelines_file, 'r', encoding='utf-8') as f:
            # Remove .pdf extension and normalize
            return {
                line.strip().replace('.pdf', '').lower() 
                for line in f if line.strip()
            }
    
    def scrape_rcog_guidelines(self) -> List[Dict]:
        """Scrape RCOG Green-top Guidelines"""
        logging.info("Scraping RCOG Green-top Guidelines...")
        guidelines = []
        
        try:
            # RCOG Green-top Guidelines page
            url = f"{self.rcog_base_url}/guidance/browse-all-guidance/green-top-guidelines/"
            response = requests.get(url, headers=self.headers, timeout=30)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Find all guideline links
            # RCOG structure: look for guideline cards/links
            guideline_links = soup.find_all('a', href=re.compile(r'/guidance/.*green-top-guideline'))
            
            for link in guideline_links:
                title = link.get_text(strip=True)
                url = link.get('href')
                
                if not url.startswith('http'):
                    url = self.rcog_base_url + url
                
                # Extract guideline number if present (e.g., "No. 76")
                number_match = re.search(r'No\.\s*(\d+[a-z]?)', title, re.IGNORECASE)
                guideline_number = number_match.group(1) if number_match else None
                
                # Extract year if present
                year_match = re.search(r'\b(20\d{2})\b', title)
                year = year_match.group(1) if year_match else None
                
                guidelines.append({
                    'source': 'RCOG',
                    'title': title,
                    'url': url,
                    'guideline_number': guideline_number,
                    'year': year,
                    'type': 'Green-top Guideline'
                })
            
            logging.info(f"Found {len(guidelines)} RCOG guidelines")
            
        except Exception as e:
            logging.error(f"Error scraping RCOG: {e}")
        
        return guidelines
    
    def scrape_nice_maternity_guidelines(self) -> List[Dict]:
        """Scrape NICE guidelines related to maternity and pregnancy"""
        logging.info("Scraping NICE guidelines...")
        guidelines = []
        
        # Key NICE guideline codes for maternity
        maternity_codes = [
            'NG201', 'NG194', 'NG235', 'NG121', 'CG192', 'CG190', 
            'NG4', 'NG25', 'NG126', 'CG149', 'QS22', 'QS109', 
            'QS115', 'QS200', 'PH11', 'PH26', 'PH27'
        ]
        
        try:
            # Try to get guidelines from NICE API or search page
            for code in maternity_codes:
                try:
                    url = f"{self.nice_base_url}/guidance/{code.lower()}"
                    response = requests.get(url, headers=self.headers, timeout=30)
                    
                    if response.status_code == 200:
                        soup = BeautifulSoup(response.content, 'html.parser')
                        
                        # Extract title
                        title_elem = soup.find('h1', class_='page-header__heading')
                        if not title_elem:
                            title_elem = soup.find('h1')
                        
                        title = title_elem.get_text(strip=True) if title_elem else code
                        
                        # Extract publication date
                        date_elem = soup.find('dd', class_='published-date')
                        if not date_elem:
                            date_elem = soup.find(string=re.compile('Published:'))
                        
                        pub_date = None
                        if date_elem:
                            date_text = date_elem.get_text(strip=True) if hasattr(date_elem, 'get_text') else str(date_elem)
                            year_match = re.search(r'\b(20\d{2})\b', date_text)
                            pub_date = year_match.group(1) if year_match else None
                        
                        guidelines.append({
                            'source': 'NICE',
                            'title': title,
                            'url': url,
                            'code': code,
                            'year': pub_date,
                            'type': self._get_nice_type(code)
                        })
                        
                        logging.info(f"Found NICE {code}: {title}")
                        
                except Exception as e:
                    logging.warning(f"Could not fetch NICE {code}: {e}")
                    continue
            
            logging.info(f"Found {len(guidelines)} NICE guidelines")
            
        except Exception as e:
            logging.error(f"Error scraping NICE: {e}")
        
        return guidelines
    
    def _get_nice_type(self, code: str) -> str:
        """Determine NICE guideline type from code"""
        if code.startswith('NG'):
            return 'NICE Guideline'
        elif code.startswith('CG'):
            return 'Clinical Guideline'
        elif code.startswith('QS'):
            return 'Quality Standard'
        elif code.startswith('PH'):
            return 'Public Health Guideline'
        else:
            return 'NICE Guidance'
    
    def normalize_title(self, title: str) -> str:
        """Normalize guideline title for comparison"""
        # Remove common prefixes/suffixes
        normalized = title.lower()
        normalized = re.sub(r'\s*\(.*?\)\s*', '', normalized)  # Remove parentheses
        normalized = re.sub(r'\s*green-top guideline.*$', '', normalized, re.IGNORECASE)
        normalized = re.sub(r'\s*no\.\s*\d+[a-z]?\s*', '', normalized, re.IGNORECASE)
        normalized = re.sub(r'[^\w\s]', '', normalized)  # Remove punctuation
        normalized = re.sub(r'\s+', ' ', normalized).strip()  # Normalize whitespace
        return normalized
    
    def compare_with_database(self, discovered_guidelines: List[Dict]) -> List[Dict]:
        """Compare discovered guidelines with current database"""
        logging.info("Comparing with current database...")
        
        current = self.get_current_guidelines()
        missing = []
        
        for guideline in discovered_guidelines:
            # Create multiple potential filename patterns
            title = guideline['title']
            year = guideline.get('year', '')
            source = guideline['source']
            
            # Generate potential filenames
            potential_names = []
            
            if source == 'RCOG':
                # RCOG patterns: "BJOG - YYYY - Title"
                if year:
                    potential_names.append(f"bjog - {year} - {title}".lower())
                    potential_names.append(f"gtg {year} - {title}".lower())
                potential_names.append(f"bjog - {title}".lower())
                potential_names.append(f"gtg - {title}".lower())
            
            elif source == 'NICE':
                code = guideline.get('code', '')
                if year and code:
                    potential_names.append(f"nice - {year} - {title}".lower())
                    potential_names.append(f"nice {code.lower()} - {title}".lower())
                if code:
                    potential_names.append(f"nice - {code.lower()}".lower())
                potential_names.append(f"nice - {title}".lower())
            
            # Normalize for comparison
            normalized_patterns = [self.normalize_title(name) for name in potential_names]
            
            # Check if any pattern matches existing guidelines
            found = False
            for pattern in normalized_patterns:
                for existing in current:
                    if pattern in existing or existing in pattern:
                        found = True
                        break
                if found:
                    break
            
            if not found:
                # Check normalized title match
                normalized_title = self.normalize_title(title)
                for existing in current:
                    existing_normalized = self.normalize_title(existing)
                    if normalized_title in existing_normalized or existing_normalized in normalized_title:
                        found = True
                        break
            
            if not found:
                guideline['status'] = 'missing'
                guideline['priority'] = self._assess_priority(guideline)
                missing.append(guideline)
                logging.info(f"Missing: {guideline['title']}")
        
        logging.info(f"Found {len(missing)} missing guidelines")
        return missing
    
    def _assess_priority(self, guideline: Dict) -> str:
        """Assess priority of missing guideline"""
        title = guideline['title'].lower()
        year = guideline.get('year')
        
        # High priority keywords
        high_priority_keywords = [
            'postnatal', 'mental health', 'neonatal infection', 
            'intrapartum', 'thyroid', 'sepsis', 'stillbirth'
        ]
        
        # Medium priority: recently published or updated
        current_year = datetime.now().year
        if year and int(year) >= current_year - 2:
            if any(keyword in title for keyword in high_priority_keywords):
                return 'high'
            return 'medium'
        
        # High priority based on content
        if any(keyword in title for keyword in high_priority_keywords):
            return 'high'
        
        # Public health guidelines are lower priority
        if guideline.get('type') == 'Public Health Guideline':
            return 'low'
        
        return 'medium'
    
    def generate_report(self, missing_guidelines: List[Dict], output_file: str = None) -> Dict:
        """Generate a JSON report of missing guidelines"""
        report = {
            'generated_at': datetime.now().isoformat(),
            'total_missing': len(missing_guidelines),
            'by_source': {},
            'by_priority': {
                'high': [],
                'medium': [],
                'low': []
            },
            'guidelines': missing_guidelines
        }
        
        # Categorize
        for guideline in missing_guidelines:
            source = guideline['source']
            priority = guideline.get('priority', 'medium')
            
            # Count by source
            if source not in report['by_source']:
                report['by_source'][source] = 0
            report['by_source'][source] += 1
            
            # Group by priority
            report['by_priority'][priority].append(guideline)
        
        # Save to file if specified
        if output_file:
            output_path = Path(output_file)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(report, f, indent=2, ensure_ascii=False)
            logging.info(f"Report saved to {output_file}")
        
        return report
    
    def run_discovery(self, output_file: str = 'data/missing_guidelines_report.json') -> Dict:
        """Run complete discovery process"""
        logging.info("Starting guideline discovery process...")
        
        # Scrape from sources
        rcog_guidelines = self.scrape_rcog_guidelines()
        nice_guidelines = self.scrape_nice_maternity_guidelines()
        
        all_discovered = rcog_guidelines + nice_guidelines
        logging.info(f"Total discovered: {len(all_discovered)}")
        
        # Compare with database
        missing = self.compare_with_database(all_discovered)
        
        # Generate report
        report = self.generate_report(missing, output_file)
        
        logging.info(f"Discovery complete. Found {len(missing)} missing guidelines.")
        logging.info(f"High priority: {len(report['by_priority']['high'])}")
        logging.info(f"Medium priority: {len(report['by_priority']['medium'])}")
        logging.info(f"Low priority: {len(report['by_priority']['low'])}")
        
        return report


def main():
    """Run the discovery service"""
    service = GuidelineDiscoveryService()
    report = service.run_discovery()
    
    # Print summary
    print("\n" + "="*60)
    print("GUIDELINE DISCOVERY REPORT")
    print("="*60)
    print(f"Total Missing Guidelines: {report['total_missing']}")
    print(f"\nBy Source:")
    for source, count in report['by_source'].items():
        print(f"  {source}: {count}")
    print(f"\nBy Priority:")
    for priority, guidelines in report['by_priority'].items():
        print(f"  {priority.upper()}: {len(guidelines)}")
    print("="*60)


if __name__ == '__main__':
    main()

